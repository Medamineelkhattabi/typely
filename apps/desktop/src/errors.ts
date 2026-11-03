import { EngineError } from "@typely/correction-engine";
import { AllProvidersFailedError, ProviderError } from "@typely/provider-adapters";

const PROVIDER_HINTS: Partial<Record<ProviderError["kind"], string>> = {
  auth: "the API key was rejected",
  not_configured: "it is not fully configured",
  network: "it could not be reached",
  timeout: "it did not answer in time",
  rate_limit: "it is rate limiting requests",
  server: "it returned a server error",
};

function describeProvider(error: ProviderError): string {
  const hint = PROVIDER_HINTS[error.kind];
  return hint === undefined
    ? `${error.providerId}: ${error.message}`
    : `${error.providerId}: ${hint} (${error.message})`;
}

/** A sentence the panel or settings window can show for any error the engine throws. */
export function describeError(error: unknown): string {
  if (error instanceof EngineError) {
    switch (error.code) {
      case "requires_ai":
      case "no_provider":
        return "This action needs an AI model. Set up Ollama or a provider in Typely's settings.";
      case "consent_required":
        return "Cloud processing is off, so no provider may be used. Turn it on under Privacy, or use a local model.";
      case "input_too_large":
        return "The selection is too long for one request.";
      case "cancelled":
        return "Cancelled.";
      default:
        if (error.cause instanceof AllProvidersFailedError)
          return `No provider could answer. ${error.cause.errors.map(describeProvider).join("; ")}`;
        return error.message;
    }
  }
  if (error instanceof AllProvidersFailedError)
    return `No provider could answer. ${error.errors.map(describeProvider).join("; ")}`;
  if (error instanceof ProviderError) return describeProvider(error);
  if (error instanceof Error) return error.message;
  return String(error);
}

export function isCancellation(error: unknown): boolean {
  return (
    (error instanceof EngineError && error.code === "cancelled") ||
    (error instanceof ProviderError && error.kind === "cancelled") ||
    (error instanceof DOMException && error.name === "AbortError")
  );
}
