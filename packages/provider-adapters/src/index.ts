export * from "./adapters/index.ts";
export * from "./chain.ts";
export * from "./endpoints.ts";
export * from "./errors.ts";
export * from "./languagetool.ts";
export * from "./transport/direct.ts";
export type * from "./types.ts";

import type {
  CompletionRequest,
  CompletionResponse,
  ProviderAdapter,
  ProviderHttpRequest,
  Transport,
} from "./types.ts";

/** Sends a completion through a transport and parses the result. */
export async function complete(
  adapter: ProviderAdapter,
  transport: Transport,
  request: CompletionRequest,
  signal?: AbortSignal,
): Promise<CompletionResponse> {
  const response = await transport.send(
    adapter.config.id,
    adapter.buildCompletion(request),
    signal,
  );
  return adapter.parseCompletion(response);
}

/** Lists models available to the configured credentials (used by "Test connection"). */
export async function listModels(
  adapter: ProviderAdapter,
  transport: Transport,
  signal?: AbortSignal,
): Promise<string[]> {
  const request: ProviderHttpRequest = { ...adapter.buildListModels(), timeoutMs: 15_000 };
  return adapter.parseListModels(await transport.send(adapter.config.id, request, signal));
}
