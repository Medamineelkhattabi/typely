import type { ProviderConfig } from "@typely/schemas";
import { AUTH_SCHEMES, isLoopbackUrl } from "../endpoints.ts";
import { ProviderError } from "../errors.ts";
import type {
  CompletionRequest,
  CompletionResponse,
  ProviderAdapter,
  ProviderHttpRequest,
  ProviderHttpResponse,
  StreamEvent,
} from "../types.ts";
import { ensureOk, invalid, isObject, optional, resolveBaseUrl, toCount } from "./shared.ts";

const DEFAULT_TEMPERATURE = 0.2;
/**
 * Keep the model loaded for 5 minutes after the last request (user decision, see ADR-016):
 * follow-up corrections skip the ~2 s load, and the memory is released when idle.
 */
export const DEFAULT_KEEP_ALIVE_SECONDS = 300;

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

  buildCompletion(
    request: CompletionRequest,
    options: { stream?: boolean } = {},
  ): ProviderHttpRequest {
    const jsonMode =
      request.outputFormat === "text" ? "none" : (this.config.json_mode ?? "json_schema");
    let format: unknown;
    if (jsonMode === "json_schema" && request.jsonSchema !== undefined)
      format = request.jsonSchema.schema;
    else if (jsonMode !== "none") format = "json";
    const modelOptions = {
      // Ollama defaults to 0.8; corrections must be repeatable (same input, same output).
      temperature: this.config.temperature ?? DEFAULT_TEMPERATURE,
      ...optional("num_predict", this.config.max_output_tokens),
    };
    const keepAliveSeconds = this.config.keep_alive_seconds ?? DEFAULT_KEEP_ALIVE_SECONDS;
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
        stream: options.stream === true,
        keep_alive: keepAliveSeconds === 0 ? 0 : `${keepAliveSeconds}s`,
        // Accepted (and ignored) by non-reasoning models; without it, reasoning models such
        // as qwen3.5 emit thousands of hidden tokens per correction.
        think: this.config.thinking ?? false,
        ...optional("format", format),
        options: modelOptions,
      },
    };
  }

  parseCompletion(response: ProviderHttpResponse): CompletionResponse {
    const id = this.config.id;
    const body = ensureOk(id, response);
    this.#assertComplete(body);
    const message = body["message"];
    if (!isObject(message) || typeof message["content"] !== "string") {
      throw invalid(id, "Response has no message content");
    }
    return { text: message["content"], ...this.#final(body) };
  }

  parseStreamLine(line: string): StreamEvent {
    const id = this.config.id;
    let body: unknown;
    try {
      body = JSON.parse(line);
    } catch {
      throw invalid(id, "Malformed stream line");
    }
    if (!isObject(body)) throw invalid(id, "Malformed stream line");
    if (typeof body["error"] === "string") {
      throw new ProviderError("server", id, `Stream error: ${body["error"]}`);
    }
    const message = body["message"];
    const delta =
      isObject(message) && typeof message["content"] === "string" ? message["content"] : "";
    if (body["done"] !== true) return { delta };
    this.#assertComplete(body);
    return { delta, final: this.#final(body) };
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

  #assertComplete(body: Record<string, unknown>): void {
    if (body["done_reason"] === "length") {
      throw new ProviderError("truncated", this.config.id, "Output was cut off by num_predict");
    }
  }

  #final(body: Record<string, unknown>): Omit<CompletionResponse, "text"> {
    return {
      model: typeof body["model"] === "string" ? body["model"] : this.config.model,
      usage: {
        inputTokens: toCount(body["prompt_eval_count"]),
        outputTokens: toCount(body["eval_count"]),
      },
    };
  }
}
