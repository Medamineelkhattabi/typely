import type { ProviderConfig } from "@typely/schemas";
import type { ProviderAdapter } from "../types.ts";
import { AnthropicAdapter } from "./anthropic.ts";
import { GeminiAdapter } from "./gemini.ts";
import { OllamaAdapter } from "./ollama.ts";
import { OpenAiAdapter } from "./openai.ts";

export { ANTHROPIC_VERSION, AnthropicAdapter } from "./anthropic.ts";
export { GeminiAdapter } from "./gemini.ts";
export { OllamaAdapter } from "./ollama.ts";
export { isReasoningModel, OpenAiAdapter } from "./openai.ts";

export function createAdapter(config: ProviderConfig): ProviderAdapter {
  switch (config.kind) {
    case "openai":
    case "openai_compatible":
      return new OpenAiAdapter(config);
    case "anthropic":
      return new AnthropicAdapter(config);
    case "gemini":
      return new GeminiAdapter(config);
    case "ollama":
      return new OllamaAdapter(config);
  }
}
