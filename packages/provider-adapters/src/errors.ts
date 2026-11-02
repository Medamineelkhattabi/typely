export const PROVIDER_ERROR_KINDS = [
  "auth",
  "rate_limit",
  "timeout",
  "network",
  "server",
  "bad_request",
  "invalid_response",
  "truncated",
  "refused",
  "cancelled",
  "not_configured",
] as const;
export type ProviderErrorKind = (typeof PROVIDER_ERROR_KINDS)[number];

const RETRYABLE: ReadonlySet<ProviderErrorKind> = new Set([
  "rate_limit",
  "timeout",
  "network",
  "server",
]);

export interface ProviderErrorOptions {
  status?: number;
  retryAfterMs?: number;
  cause?: unknown;
}

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly providerId: string;
  readonly status: number | undefined;
  readonly retryAfterMs: number | undefined;

  constructor(
    kind: ProviderErrorKind,
    providerId: string,
    message: string,
    options: ProviderErrorOptions = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ProviderError";
    this.kind = kind;
    this.providerId = providerId;
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
  }

  /** Whether retrying the same provider may succeed. */
  get retryable(): boolean {
    return RETRYABLE.has(this.kind);
  }
}

export class AllProvidersFailedError extends Error {
  readonly errors: readonly ProviderError[];

  constructor(errors: readonly ProviderError[]) {
    const summary = errors.map((e) => `${e.providerId}: ${e.kind} (${e.message})`).join("; ");
    super(errors.length === 0 ? "No provider is configured" : `All providers failed — ${summary}`);
    this.name = "AllProvidersFailedError";
    this.errors = errors;
  }
}

export function kindForStatus(status: number): ProviderErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 408 || status === 504) return "timeout";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "server";
  return "bad_request";
}

/** Extracts a human-readable message from the error bodies of the supported APIs. */
export function extractErrorMessage(body: unknown): string | undefined {
  if (typeof body === "string") return body.slice(0, 500) || undefined;
  if (typeof body !== "object" || body === null) return undefined;
  const error = (body as Record<string, unknown>)["error"];
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null) {
    const message = (error as Record<string, unknown>)["message"];
    if (typeof message === "string") return message;
  }
  const message = (body as Record<string, unknown>)["message"];
  return typeof message === "string" ? message : undefined;
}

/** Parses a Retry-After header (seconds or HTTP date) into milliseconds. */
export function parseRetryAfter(value: string | undefined, now = Date.now()): number | undefined {
  if (value === undefined) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}
