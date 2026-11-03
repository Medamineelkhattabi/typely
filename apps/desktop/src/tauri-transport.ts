import {
  PROVIDER_ERROR_KINDS,
  ProviderError,
  type ProviderErrorKind,
  type ProviderHttpRequest,
  type ProviderHttpResponse,
  type Transport,
} from "@typely/provider-adapters";

/** Messages of the Rust `StreamMessage` enum; `end` follows the last line. */
export type StreamMessage = { type: "line"; line: string } | { type: "end" };

/** The pieces of `@tauri-apps/api` the transport uses; injected so tests can fake them. */
export interface TauriBindings {
  invoke<T>(command: string, args: Record<string, unknown>): Promise<T>;
  /** Returns a `Channel` to pass as a command argument. */
  createChannel(onMessage: (message: StreamMessage) => void): unknown;
  newRequestId(): string;
}

interface WireResponse {
  status: number;
  headers: Record<string, string>;
  body?: unknown;
}

/** Lines can trail the command's result over IPC; this bounds the wait for `end`. */
const END_GRACE_MS = 2_000;

/**
 * Transport for the desktop webviews. Requests go to the Rust executor by endpoint id
 * (`provider_request` / `provider_stream`); Rust attaches the API key, so the webview never
 * sees one. Streaming uses a Tauri channel, and aborting the signal calls `provider_cancel`.
 */
export class TauriTransport implements Transport {
  readonly #bindings: TauriBindings;

  constructor(bindings: TauriBindings) {
    this.#bindings = bindings;
  }

  send(
    endpointId: string,
    request: ProviderHttpRequest,
    signal?: AbortSignal,
  ): Promise<ProviderHttpResponse> {
    return this.#call(endpointId, request, undefined, signal);
  }

  stream(
    endpointId: string,
    request: ProviderHttpRequest,
    onLine: (line: string) => void,
    signal?: AbortSignal,
  ): Promise<ProviderHttpResponse> {
    return this.#call(endpointId, request, onLine, signal);
  }

  async #call(
    endpointId: string,
    request: ProviderHttpRequest,
    onLine: ((line: string) => void) | undefined,
    signal?: AbortSignal,
  ): Promise<ProviderHttpResponse> {
    const cancelled = () => new ProviderError("cancelled", endpointId, "Request cancelled");
    if (signal?.aborted) throw cancelled();
    const { invoke, createChannel, newRequestId } = this.#bindings;
    const requestId = newRequestId();
    const cancel = () => {
      invoke("provider_cancel", { requestId }).catch(() => undefined);
    };
    signal?.addEventListener("abort", cancel, { once: true });

    // An error thrown by the consumer (e.g. a ProviderError for an error line) stops the
    // request and is what the caller sees, as with DirectTransport.
    let consumerError: unknown;
    let markEnded = () => {};
    const ended = new Promise<void>((resolve) => {
      markEnded = resolve;
    });
    const args: Record<string, unknown> = { endpointId, request, requestId };
    if (onLine !== undefined) {
      args["onLine"] = createChannel((message) => {
        if (message.type === "end") {
          markEnded();
          return;
        }
        if (consumerError !== undefined) return;
        try {
          onLine(message.line);
        } catch (error) {
          consumerError = error;
          cancel();
        }
      });
    }

    try {
      const command = onLine === undefined ? "provider_request" : "provider_stream";
      const response = await invoke<WireResponse>(command, args);
      if (onLine !== undefined && response.status >= 200 && response.status < 300) {
        await Promise.race([ended, delay(END_GRACE_MS)]);
      }
      if (consumerError !== undefined) throw consumerError;
      return { status: response.status, headers: response.headers, body: response.body };
    } catch (error) {
      if (consumerError !== undefined) throw consumerError;
      if (error instanceof ProviderError) throw error;
      if (signal?.aborted) throw cancelled();
      throw toProviderError(endpointId, error);
    } finally {
      signal?.removeEventListener("abort", cancel);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isErrorKind(value: unknown): value is ProviderErrorKind {
  return typeof value === "string" && (PROVIDER_ERROR_KINDS as readonly string[]).includes(value);
}

/** Maps a rejected `invoke` (the Rust `TransportError`, or an IPC error string). */
export function toProviderError(endpointId: string, error: unknown): ProviderError {
  if (typeof error === "object" && error !== null) {
    const { kind, message } = error as { kind?: unknown; message?: unknown };
    if (isErrorKind(kind) && typeof message === "string") {
      return new ProviderError(kind, endpointId, message);
    }
  }
  // Not a transport result (e.g. a command the window is not allowed to call): not retryable.
  const text = error instanceof Error ? error.message : String(error);
  return new ProviderError("not_configured", endpointId, `Desktop transport error: ${text}`, {
    cause: error,
  });
}
