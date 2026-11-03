import type { ProviderConfig } from "@typely/schemas";
import { DEFAULT_BASE_URLS } from "../endpoints.ts";
import { extractErrorMessage, kindForStatus, ProviderError, parseRetryAfter } from "../errors.ts";
import type { ProviderHttpResponse } from "../types.ts";

export type JsonObject = Record<string, unknown>;

export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function resolveBaseUrl(config: ProviderConfig): string {
  const url = config.base_url ?? DEFAULT_BASE_URLS[config.kind];
  if (url === undefined) {
    throw new ProviderError("not_configured", config.id, `Provider '${config.id}' has no base URL`);
  }
  return url.replace(/\/+$/, "");
}

/** Throws a classified ProviderError for non-2xx responses; returns the body object otherwise. */
export function ensureOk(providerId: string, response: ProviderHttpResponse): JsonObject {
  const { status, body } = response;
  if (status < 200 || status >= 300) {
    const detail = extractErrorMessage(body) ?? "no details";
    // Groq answers 400 "json_validate_failed" when the model's own JSON came out malformed:
    // a generation accident, not a bad request, so another try usually works.
    const kind = isGenerationFailure(body) ? "server" : kindForStatus(status);
    throw new ProviderError(kind, providerId, `HTTP ${status}: ${detail}`, {
      status,
      ...optional("retryAfterMs", parseRetryAfter(response.headers["retry-after"])),
    });
  }
  if (!isObject(body)) {
    throw new ProviderError("invalid_response", providerId, "Expected a JSON object response", {
      status,
    });
  }
  return body;
}

function isGenerationFailure(body: unknown): boolean {
  const error = isObject(body) ? body["error"] : undefined;
  return isObject(error) && error["code"] === "json_validate_failed";
}

export function invalid(providerId: string, message: string): ProviderError {
  return new ProviderError("invalid_response", providerId, message);
}

/** Spreads `{ [key]: value }` only when value is defined (exactOptionalPropertyTypes-friendly). */
export function optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
}

export function toCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
}
