import type { ProviderConfig, ProviderKind } from "@typely/schemas";

/** How the trusted executor attaches a secret to a request. Mirrored in Rust. */
export type AuthScheme =
  | { type: "none" }
  | { type: "bearer"; optional: boolean }
  | { type: "header"; name: string; optional: boolean }
  | { type: "form_field"; name: string; optional: boolean };

/** A request relative to an endpoint. Contains no secret and no host. */
export interface ProviderHttpRequest {
  method: "GET" | "POST";
  /** Path relative to the endpoint base URL, starting with "/". May include a query string. */
  path: string;
  /** JSON body, or string fields when `encoding` is "form". */
  body?: unknown;
  encoding?: "json" | "form";
  /** Non-secret headers (e.g. API version). Auth headers are stripped by transports. */
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface ProviderHttpResponse {
  status: number;
  /** Lower-cased header names. */
  headers: Record<string, string>;
  /** Parsed JSON when the response is JSON, otherwise the raw text. */
  body: unknown;
}

/**
 * Executes requests for an endpoint id. The trusted side maps the id to a base URL, an
 * auth scheme and a secret; callers can never choose the host a secret is sent to.
 * Implementations return any HTTP status and throw ProviderError only for transport
 * failures (network, timeout, cancellation, missing configuration).
 */
export interface Transport {
  send(
    endpointId: string,
    request: ProviderHttpRequest,
    signal?: AbortSignal,
  ): Promise<ProviderHttpResponse>;
  /**
   * Optional streaming variant for newline-delimited responses (e.g. Ollama NDJSON). For a
   * 2xx response every line is passed to `onLine` and the returned body is undefined; any
   * other status returns the full body, exactly like `send`.
   */
  stream?(
    endpointId: string,
    request: ProviderHttpRequest,
    onLine: (line: string) => void,
    signal?: AbortSignal,
  ): Promise<ProviderHttpResponse>;
}

export interface CompletionRequest {
  system: string;
  user: string;
  /** When set, the adapter asks the provider for schema-constrained JSON if supported. */
  jsonSchema?: { name: string; schema: Readonly<Record<string, unknown>> };
  /** Output budget estimated by the caller; used where the API requires a limit. */
  suggestedMaxOutputTokens: number;
  /** "text" asks for the bare result (no JSON mode); defaults to "json". */
  outputFormat?: "json" | "text";
}

/** One parsed line of a streamed completion. */
export interface StreamEvent {
  /** Newly generated text (may be empty). */
  delta: string;
  /** Present on the final line. */
  final?: Omit<CompletionResponse, "text">;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface CompletionResponse {
  text: string;
  model: string;
  usage?: TokenUsage;
}

export interface ProviderAdapter {
  readonly config: ProviderConfig;
  readonly kind: ProviderKind;
  /** Effective base URL (configured or the provider default). */
  readonly baseUrl: string;
  readonly auth: AuthScheme;
  /** True when the endpoint is on the loopback interface (text never leaves the machine). */
  readonly isLocal: boolean;
  buildCompletion(request: CompletionRequest, options?: { stream?: boolean }): ProviderHttpRequest;
  parseCompletion(response: ProviderHttpResponse): CompletionResponse;
  /** Implemented by adapters that support streaming; throws ProviderError on error lines. */
  parseStreamLine?(line: string): StreamEvent;
  buildListModels(): ProviderHttpRequest;
  parseListModels(response: ProviderHttpResponse): string[];
}
