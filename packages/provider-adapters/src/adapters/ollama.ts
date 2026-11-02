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

/** Ollama native `/api/chat`. Local by default; a remote Ollama URL is treated as cloud. */
export class OllamaAdapter implements ProviderAdapter {
  readonly config: ProviderConfig;
  readonly kind = "ollama" as const;
  readonly baseUrl: string;
  readonly auth = AUTH_SCHEMES.ollama;
  readonly isLocal: boolean;

  constructor(config: ProviderConfig) {
    if (config.kind !== "ollama") {
      throw new Error(`OllamaAdapter cannot handle provider kind '${config.kind}'`);
    }
    this.config = config;
    this.baseUrl = resolveBaseUrl(config);
    this.isLocal = isLoopbackUrl(this.baseUrl);
  }

  buildCompletion(request: CompletionRequest): ProviderHttpRequest {
    const jsonMode = this.config.json_mode ?? "json_schema";
    let format: unknown;
    if (jsonMode === "json_schema" && request.jsonSchema !== undefined)
      format = request.jsonSchema.schema;
    else if (jsonMode !== "none") format = "json";
    const options = {
      ...optional("temperature", this.config.temperature),
      ...optional("num_predict", this.config.max_output_tokens),
    };
    // 0 = unload right after this request (Ollama's own default keeps models for 5 minutes).
    const keepAliveSeconds = this.config.keep_alive_seconds ?? 0;
    return {
      method: "POST",
      path: "/api/chat",
      // Local models can be slow to load on first use.
      timeoutMs: this.config.timeout_ms ?? 120_000,
      body: {
        model: this.config.model,
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.user },
        ],
        stream: false,
        keep_alive: keepAliveSeconds === 0 ? 0 : `${keepAliveSeconds}s`,
        ...optional("format", format),
        ...optional("options", Object.keys(options).length > 0 ? options : undefined),
      },
    };
  }

  parseCompletion(response: ProviderHttpResponse): CompletionResponse {
    const id = this.config.id;
    const body = ensureOk(id, response);
    if (body["done_reason"] === "length") {
      throw new ProviderError("truncated", id, "Output was cut off by num_predict");
    }
    const message = body["message"];
    if (!isObject(message) || typeof message["content"] !== "string") {
      throw invalid(id, "Response has no message content");
    }
    return {
      text: message["content"],
      model: typeof body["model"] === "string" ? body["model"] : this.config.model,
      usage: {
        inputTokens: toCount(body["prompt_eval_count"]),
        outputTokens: toCount(body["eval_count"]),
      },
    };
  }

  buildListModels(): ProviderHttpRequest {
    return { method: "GET", path: "/api/tags" };
  }

  parseListModels(response: ProviderHttpResponse): string[] {
    const models = ensureOk(this.config.id, response)["models"];
    if (!Array.isArray(models)) throw invalid(this.config.id, "Model list has no models array");
    return models
      .map((m) => (isObject(m) && typeof m["name"] === "string" ? m["name"] : undefined))
      .filter((m): m is string => m !== undefined)
      .sort();
  }
}
