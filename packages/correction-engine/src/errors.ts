export const ENGINE_ERROR_CODES = [
  "invalid_request",
  "input_too_large",
  "requires_ai",
  "consent_required",
  "no_provider",
  "provider_failed",
  "cancelled",
] as const;
export type EngineErrorCode = (typeof ENGINE_ERROR_CODES)[number];

/** Errors a UI is expected to explain to the user. */
export class EngineError extends Error {
  readonly code: EngineErrorCode;
  /** Provider ids involved (e.g. the ones lacking consent). */
  readonly providerIds: readonly string[];

  constructor(
    code: EngineErrorCode,
    message: string,
    options: { providerIds?: string[]; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "EngineError";
    this.code = code;
    this.providerIds = options.providerIds ?? [];
  }
}
