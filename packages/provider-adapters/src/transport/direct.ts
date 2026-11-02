import { joinEndpointUrl, SECRET_HEADER_NAMES } from "../endpoints.ts";
import { ProviderError } from "../errors.ts";
import type { AuthScheme, ProviderHttpRequest, ProviderHttpResponse, Transport } from "../types.ts";

export interface EndpointDefinition {
  baseUrl: string;
  auth: AuthScheme;
}

export type SecretResolver = (
  endpointId: string,
) => Promise<string | undefined> | string | undefined;

export interface DirectTransportOptions {
  endpoints: ReadonlyMap<string, EndpointDefinition>;
  getSecret: SecretResolver;
  fetch?: typeof globalThis.fetch;
  defaultTimeoutMs?: number;
}

/**
 * fetch-based transport for trusted JavaScript contexts: Node (CLI, tests) and the
 * extension service worker in standalone mode. Never instantiate it in a content script
 * or a desktop webview — those use transports that delegate to the trusted executor.
 */
export class DirectTransport implements Transport {
  readonly #endpoints: ReadonlyMap<string, EndpointDefinition>;
  readonly #getSecret: SecretResolver;
  readonly #fetch: typeof globalThis.fetch;
  readonly #defaultTimeoutMs: number;

  constructor(options: DirectTransportOptions) {
    this.#endpoints = options.endpoints;
    this.#getSecret = options.getSecret;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#defaultTimeoutMs = options.defaultTimeoutMs ?? 45_000;
  }

  async send(
    endpointId: string,
    request: ProviderHttpRequest,
    signal?: AbortSignal,
  ): Promise<ProviderHttpResponse> {
    const endpoint = this.#endpoints.get(endpointId);
    if (endpoint === undefined) {
      throw new ProviderError("not_configured", endpointId, `Unknown endpoint '${endpointId}'`);
    }
    const url = joinEndpointUrl(endpoint.baseUrl, request.path);

    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers ?? {})) {
      if (!SECRET_HEADER_NAMES.has(name.toLowerCase())) headers.set(name, value);
    }
    headers.set("accept", "application/json");

    let formFields: Record<string, string> | undefined;
    let body: string | undefined;
    if (request.body !== undefined) {
      if (request.encoding === "form") {
        formFields = toFormFields(request.body);
        headers.set("content-type", "application/x-www-form-urlencoded");
      } else {
        body = JSON.stringify(request.body);
        headers.set("content-type", "application/json");
      }
    }

    await this.#applyAuth(endpointId, endpoint.auth, headers, formFields);
    if (formFields !== undefined) body = new URLSearchParams(formFields).toString();

    // An explicit timer (not AbortSignal.timeout, whose timer is unref'd) that also covers
    // reading the body, and is always cleared.
    const timeoutMs = request.timeoutMs ?? this.#defaultTimeoutMs;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onCancel = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener("abort", onCancel, { once: true });

    const fail = (error: unknown, stage: string): ProviderError => {
      if (signal?.aborted) return new ProviderError("cancelled", endpointId, "Request cancelled");
      if (timedOut)
        return new ProviderError("timeout", endpointId, `No response within ${timeoutMs} ms`);
      return new ProviderError("network", endpointId, `${stage}: ${describe(error)}`, {
        cause: error,
      });
    };

    try {
      if (controller.signal.aborted) throw fail(undefined, "Network error");
      let response: Response;
      try {
        response = await this.#fetch(url, {
          method: request.method,
          headers,
          ...(body === undefined ? {} : { body }),
          signal: controller.signal,
          redirect: "error",
          credentials: "omit",
        });
      } catch (error) {
        throw fail(error, "Network error");
      }

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, name) => {
        responseHeaders[name.toLowerCase()] = value;
      });
      let text: string;
      try {
        text = await response.text();
      } catch (error) {
        throw fail(error, "Failed reading response");
      }
      return { status: response.status, headers: responseHeaders, body: parseBody(text) };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onCancel);
    }
  }

  async #applyAuth(
    endpointId: string,
    auth: AuthScheme,
    headers: Headers,
    formFields: Record<string, string> | undefined,
  ): Promise<void> {
    if (auth.type === "none") return;
    const secret = await this.#getSecret(endpointId);
    if (secret === undefined || secret === "") {
      if (auth.optional) return;
      throw new ProviderError(
        "not_configured",
        endpointId,
        `No API key configured for '${endpointId}'`,
      );
    }
    switch (auth.type) {
      case "bearer":
        headers.set("authorization", `Bearer ${secret}`);
        return;
      case "header":
        headers.set(auth.name, secret);
        return;
      case "form_field":
        // Without a form body there is nowhere safe to put the key; never fall back to the URL.
        if (formFields === undefined) {
          throw new ProviderError(
            "not_configured",
            endpointId,
            "Form-field auth requires a form body",
          );
        }
        formFields[auth.name] = secret;
        return;
    }
  }
}

function toFormFields(body: unknown): Record<string, string> {
  if (typeof body !== "object" || body === null) throw new Error("Form body must be an object");
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined) fields[key] = String(value);
  }
  return fields;
}

function parseBody(text: string): unknown {
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const NETWORK_HINTS: Readonly<Record<string, string>> = {
  ECONNREFUSED: "connection refused — is the server running?",
  ENOTFOUND: "host not found",
  ECONNRESET: "connection reset by the server",
  ETIMEDOUT: "connection timed out",
  CERT_HAS_EXPIRED: "TLS certificate expired",
};

function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  // Node's fetch hides the real reason (e.g. ECONNREFUSED) in a nested cause, sometimes an
  // AggregateError with an empty message.
  const cause = error.cause;
  const nested = cause instanceof AggregateError ? cause.errors[0] : cause;
  const code =
    typeof nested === "object" && nested !== null && "code" in nested
      ? String(nested.code)
      : undefined;
  if (code !== undefined) return `${error.message}: ${NETWORK_HINTS[code] ?? code}`;
  const detail = nested instanceof Error && nested.message ? ` (${nested.message})` : "";
  return `${error.message}${detail}`;
}
