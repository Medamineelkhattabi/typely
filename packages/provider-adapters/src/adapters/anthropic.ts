import type { ProviderConfig } from "@typely/schemas";
import { AUTH_SCHEMES, isLoopbackUrl } from "../endpoints.ts";
import { ProviderError } from "../errors.ts";
import type {
  CompletionRequest,
  CompletionResponse,
  ProviderAdapter,
  ProviderHttpRequest,
  ProviderHttpResponse,
} from "../types.ts";
import { ensureOk, invalid, isObject, optional, resolveBaseUrl, toCount } from "./shared.ts";

export const ANTHROPIC_VERSION = "2023-06-01";

/** Anthropic Messages API. */
export class AnthropicAdapter implements ProviderAdapter {
  readonly config: ProviderConfig;
  readonly kind = "anthropic" as const;
  readonly baseUrl: string;
  readonly auth = AUTH_SCHEMES.anthropic;
  readonly isLocal: boolean;

  constructor(config: ProviderConfig) {
    if (config.kind !== "anthropic") {
      throw new Error(`AnthropicAdapter cannot handle provider kind '${config.kind}'`);
    }
    this.config = config;
    this.baseUrl = resolveBaseUrl(config);
    this.isLocal = isLoopbackUrl(this.baseUrl);
  }

  buildCompletion(request: CompletionRequest): ProviderHttpRequest {
    // Structured outputs via output_config.format (GA, no beta header). Older models that do
    // not support it can be configured with json_mode "none".
    const useSchema =
      (this.config.json_mode ?? "json_schema") === "json_schema" && request.jsonSchema;
    return {
      method: "POST",
      path: "/v1/messages",
      headers: { "anthropic-version": ANTHROPIC_VERSION },
      ...optional("timeoutMs", this.config.timeout_ms),
      body: {
        model: this.config.model,
        max_tokens: this.config.max_output_tokens ?? request.suggestedMaxOutputTokens,
        system: request.system,
        messages: [{ role: "user", content: request.user }],
        ...optional("temperature", this.config.temperature),
        ...optional(
          "output_config",
          useSchema ? { format: { type: "json_schema", schema: useSchema.schema } } : undefined,
        ),
      },
    };
  }

  parseCompletion(response: ProviderHttpResponse): CompletionResponse {
    const id = this.config.id;
    const body = ensureOk(id, response);
    const stopReason = body["stop_reason"];
    if (stopReason === "max_tokens") {
      throw new ProviderError("truncated", id, "Output was cut off by max_tokens");
    }
    if (stopReason === "refusal")
      throw new ProviderError("refused", id, "Model declined the request");
    const content = body["content"];
    if (!Array.isArray(content)) throw invalid(id, "Response has no content array");
    const text = content
      .filter((b) => isObject(b) && b["type"] === "text" && typeof b["text"] === "string")
      .map((b) => (b as { text: string }).text)
      .join("");
    if (text.length === 0) throw invalid(id, "Response contains no text block");
    const usage = body["usage"];
    return {
      text,
      model: typeof body["model"] === "string" ? body["model"] : this.config.model,
      ...optional(
        "usage",
        isObject(usage)
          ? {
              inputTokens: toCount(usage["input_tokens"]),
              outputTokens: toCount(usage["output_tokens"]),
            }
          : undefined,
      ),
    };
  }

  buildListModels(): ProviderHttpRequest {
    return {
      method: "GET",
      path: "/v1/models?limit=1000",
      headers: { "anthropic-version": ANTHROPIC_VERSION },
    };
  }

  parseListModels(response: ProviderHttpResponse): string[] {
    const data = ensureOk(this.config.id, response)["data"];
    if (!Array.isArray(data)) throw invalid(this.config.id, "Model list has no data array");
    return data
      .map((m) => (isObject(m) && typeof m["id"] === "string" ? m["id"] : undefined))
      .filter((m): m is string => m !== undefined);
  }
}
