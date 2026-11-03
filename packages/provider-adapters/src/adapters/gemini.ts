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

const BLOCKING_FINISH_REASONS = new Set([
  "SAFETY",
  "RECITATION",
  "BLOCKLIST",
  "PROHIBITED_CONTENT",
  "SPII",
  "LANGUAGE",
]);

/** Google Gemini `generateContent`. See ADR-009 for why native schema enforcement is not used. */
export class GeminiAdapter implements ProviderAdapter {
  readonly config: ProviderConfig;
  readonly kind = "gemini" as const;
  readonly baseUrl: string;
  readonly auth = AUTH_SCHEMES.gemini;
  readonly isLocal: boolean;

  constructor(config: ProviderConfig) {
    if (config.kind !== "gemini") {
      throw new Error(`GeminiAdapter cannot handle provider kind '${config.kind}'`);
    }
    this.config = config;
    this.baseUrl = resolveBaseUrl(config);
    this.isLocal = isLoopbackUrl(this.baseUrl);
  }

  buildCompletion(request: CompletionRequest): ProviderHttpRequest {
    const model = this.config.model.replace(/^models\//, "");
    const generationConfig = {
      ...optional(
        "responseMimeType",
        request.outputFormat === "text" || (this.config.json_mode ?? "json_object") === "none"
          ? undefined
          : "application/json",
      ),
      ...optional("temperature", this.config.temperature),
      ...optional("maxOutputTokens", this.config.max_output_tokens),
    };
    return {
      method: "POST",
      path: `/models/${encodeURIComponent(model)}:generateContent`,
      ...optional("timeoutMs", this.config.timeout_ms),
      body: {
        systemInstruction: { parts: [{ text: request.system }] },
        contents: [{ role: "user", parts: [{ text: request.user }] }],
        generationConfig,
      },
    };
  }

  parseCompletion(response: ProviderHttpResponse): CompletionResponse {
    const id = this.config.id;
    const body = ensureOk(id, response);
    const feedback = body["promptFeedback"];
    if (isObject(feedback) && typeof feedback["blockReason"] === "string") {
      throw new ProviderError("refused", id, `Prompt blocked: ${feedback["blockReason"]}`);
    }
    const candidates = body["candidates"];
    const candidate = Array.isArray(candidates) ? candidates[0] : undefined;
    if (!isObject(candidate)) throw invalid(id, "Response has no candidates");
    const finishReason = candidate["finishReason"];
    if (finishReason === "MAX_TOKENS") {
      throw new ProviderError("truncated", id, "Output was cut off by maxOutputTokens");
    }
    if (typeof finishReason === "string" && BLOCKING_FINISH_REASONS.has(finishReason)) {
      throw new ProviderError("refused", id, `Output blocked: ${finishReason}`);
    }
    const content = candidate["content"];
    const parts = isObject(content) && Array.isArray(content["parts"]) ? content["parts"] : [];
    const text = parts
      // Thought summaries are not part of the answer.
      .filter((p) => isObject(p) && typeof p["text"] === "string" && p["thought"] !== true)
      .map((p) => (p as { text: string }).text)
      .join("");
    if (text.length === 0) throw invalid(id, "Response contains no text");
    const usage = body["usageMetadata"];
    return {
      text,
      model: typeof body["modelVersion"] === "string" ? body["modelVersion"] : this.config.model,
      ...optional(
        "usage",
        isObject(usage)
          ? {
              inputTokens: toCount(usage["promptTokenCount"]),
              // Thinking tokens are billed as output.
              outputTokens:
                toCount(usage["candidatesTokenCount"]) + toCount(usage["thoughtsTokenCount"]),
            }
          : undefined,
      ),
    };
  }

  buildListModels(): ProviderHttpRequest {
    return { method: "GET", path: "/models?pageSize=1000" };
  }

  parseListModels(response: ProviderHttpResponse): string[] {
    const models = ensureOk(this.config.id, response)["models"];
    if (!Array.isArray(models)) throw invalid(this.config.id, "Model list has no models array");
    return models
      .filter(
        (m) =>
          isObject(m) &&
          typeof m["name"] === "string" &&
          Array.isArray(m["supportedGenerationMethods"]) &&
          m["supportedGenerationMethods"].includes("generateContent"),
      )
      .map((m) => (m as { name: string }).name.replace(/^models\//, ""))
      .sort();
  }
}
