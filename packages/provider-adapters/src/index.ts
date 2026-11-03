export * from "./adapters/index.ts";
export * from "./chain.ts";
export * from "./endpoints.ts";
export * from "./errors.ts";
export * from "./languagetool.ts";
export * from "./transport/direct.ts";
export type * from "./types.ts";

import { ProviderError } from "./errors.ts";
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

/**
 * Like `complete`, but reports the text generated so far through `onText` as it arrives.
 * Falls back to a single non-streamed request (one `onText` call) when the transport or the
 * adapter cannot stream.
 */
export async function completeStreaming(
  adapter: ProviderAdapter,
  transport: Transport,
  request: CompletionRequest,
  onText: (textSoFar: string) => void,
  signal?: AbortSignal,
): Promise<CompletionResponse> {
  const parseLine = adapter.parseStreamLine?.bind(adapter);
  if (transport.stream === undefined || parseLine === undefined) {
    const response = await complete(adapter, transport, request, signal);
    onText(response.text);
    return response;
  }
  let text = "";
  let final: Omit<CompletionResponse, "text"> | undefined;
  const response = await transport.stream(
    adapter.config.id,
    adapter.buildCompletion(request, { stream: true }),
    (line) => {
      const event = parseLine(line);
      if (event.delta) {
        text += event.delta;
        onText(text);
      }
      if (event.final !== undefined) final = event.final;
    },
    signal,
  );
  if (response.status < 200 || response.status >= 300) {
    // Non-2xx bodies are returned whole; the adapter classifies them.
    return adapter.parseCompletion(response);
  }
  if (final === undefined) {
    throw new ProviderError(
      "invalid_response",
      adapter.config.id,
      "Stream ended without a final message",
    );
  }
  return { text, ...final };
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
