import type { ProviderConfig } from "@typely/schemas";
import { AUTH_SCHEMES, isLoopbackUrl } from "../endpoints.ts";
import { ProviderError } from "../errors.ts";
import type {
  AuthScheme,
  CompletionRequest,
  CompletionResponse,
  ProviderAdapter,
  ProviderHttpRequest,
  ProviderHttpResponse,
} from "../types.ts";
import { ensureOk, invalid, isObject, optional, resolveBaseUrl, toCount } from "./shared.ts";

/**
 * OpenAI Chat Completions, also used for OpenAI-compatible servers (vLLM, LM Studio,
 * OpenRouter, Groq, Azure-style gateways…).
 */
export class OpenAiAdapter implements ProviderAdapter {
  readonly config: ProviderConfig;
  readonly kind: "openai" | "openai_compatible";
  readonly baseUrl: string;
  readonly auth: AuthScheme;
  readonly isLocal: boolean;

  constructor(config: ProviderConfig) {
    if (config.kind !== "openai" && config.kind !== "openai_compatible") {
      throw new Error(`OpenAiAdapter cannot handle provider kind '${config.kind}'`);
    }
    this.config = config;
    this.kind = config.kind;
    this.baseUrl = resolveBaseUrl(config);
    this.auth = AUTH_SCHEMES[config.kind];
    this.isLocal = isLoopbackUrl(this.baseUrl);
  }

  buildCompletion(request: CompletionRequest): ProviderHttpRequest {
    const jsonMode =
      this.config.json_mode ?? (this.kind === "openai" ? "json_schema" : "json_object");
    let responseFormat: unknown;
    if (jsonMode === "json_schema" && request.jsonSchema !== undefined) {
      responseFormat = {
        type: "json_schema",
        json_schema: {
          name: request.jsonSchema.name,
          strict: true,
          schema: request.jsonSchema.schema,
        },
      };
    } else if (jsonMode !== "none") {
      responseFormat = { type: "json_object" };
    }
    // OpenAI renamed max_tokens to max_completion_tokens; many compatible servers only know the old name.
    const maxTokensKey = this.kind === "openai" ? "max_completion_tokens" : "max_tokens";
    return {
      method: "POST",
      path: "/chat/completions",
      ...optional("timeoutMs", this.config.timeout_ms),
      body: {
        model: this.config.model,
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.user },
        ],
        ...optional("response_format", responseFormat),
        // Only sent when configured: reasoning models reject non-default temperatures and
        // count hidden reasoning against the token limit.
        ...optional("temperature", this.config.temperature),
        ...optional(maxTokensKey, this.config.max_output_tokens),
      },
    };
  }

  parseCompletion(response: ProviderHttpResponse): CompletionResponse {
    const id = this.config.id;
    const body = ensureOk(id, response);
    const choices = body["choices"];
    const choice = Array.isArray(choices) ? choices[0] : undefined;
    if (!isObject(choice) || !isObject(choice["message"])) {
      throw invalid(id, "Response has no choices");
    }
    const message = choice["message"];
    if (typeof message["refusal"] === "string" && message["refusal"].length > 0) {
      throw new ProviderError("refused", id, `Model refused: ${message["refusal"]}`);
    }
    if (choice["finish_reason"] === "length") {
      throw new ProviderError("truncated", id, "Output was cut off by the token limit");
    }
    if (choice["finish_reason"] === "content_filter") {
      throw new ProviderError("refused", id, "Output blocked by the provider's content filter");
    }
    const content = message["content"];
    if (typeof content !== "string") throw invalid(id, "Response message has no text content");
    const usage = body["usage"];
    return {
      text: content,
      model: typeof body["model"] === "string" ? body["model"] : this.config.model,
      ...optional(
        "usage",
        isObject(usage)
          ? {
              inputTokens: toCount(usage["prompt_tokens"]),
              outputTokens: toCount(usage["completion_tokens"]),
            }
          : undefined,
      ),
    };
  }

  buildListModels(): ProviderHttpRequest {
    return { method: "GET", path: "/models" };
  }

  parseListModels(response: ProviderHttpResponse): string[] {
    const data = ensureOk(this.config.id, response)["data"];
    if (!Array.isArray(data)) throw invalid(this.config.id, "Model list has no data array");
    return data
      .map((m) => (isObject(m) && typeof m["id"] === "string" ? m["id"] : undefined))
      .filter((m): m is string => m !== undefined)
      .sort();
  }
}
