import { type ProviderConfigInput, ProviderConfigSchema } from "@typely/schemas";
import { describe, expect, it } from "vitest";
import {
  ANTHROPIC_VERSION,
  type CompletionRequest,
  createAdapter,
  ProviderError,
  type ProviderHttpResponse,
} from "../src/index.ts";

const config = (input: Omit<ProviderConfigInput, "label">) =>
  ProviderConfigSchema.parse({ label: "Test", ...input });
const request: CompletionRequest = {
  system: "SYSTEM",
  user: "USER",
  jsonSchema: { name: "typely_correction", schema: { type: "object" } },
  suggestedMaxOutputTokens: 2048,
};
const ok = (body: unknown, headers: Record<string, string> = {}): ProviderHttpResponse => ({
  status: 200,
  headers,
  body,
});
const status = (
  code: number,
  body: unknown,
  headers: Record<string, string> = {},
): ProviderHttpResponse => ({
  status: code,
  headers,
  body,
});

function expectProviderError(fn: () => unknown, kind: ProviderError["kind"]): ProviderError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).kind).toBe(kind);
    return error as ProviderError;
  }
  throw new Error(`Expected ProviderError(${kind})`);
}

describe("OpenAI adapter", () => {
  const adapter = createAdapter(config({ id: "oa", kind: "openai", model: "gpt-test" }));

  it("builds a strict json_schema chat completion without secrets or unset sampling params", () => {
    const built = adapter.buildCompletion(request);
    expect(built).toMatchObject({ method: "POST", path: "/chat/completions" });
    expect(built.body).toEqual({
      model: "gpt-test",
      messages: [
        { role: "system", content: "SYSTEM" },
        { role: "user", content: "USER" },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "typely_correction", strict: true, schema: { type: "object" } },
      },
    });
    expect(adapter.baseUrl).toBe("https://api.openai.com/v1");
    expect(adapter.auth).toEqual({ type: "bearer", optional: false });
    expect(adapter.isLocal).toBe(false);
  });

  it("parses content and usage", () => {
    const parsed = adapter.parseCompletion(
      ok({
        model: "gpt-test-2026",
        choices: [{ message: { content: "{}" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    );
    expect(parsed).toEqual({
      text: "{}",
      model: "gpt-test-2026",
      usage: { inputTokens: 10, outputTokens: 5 },
    });
  });

  it("classifies refusals, truncation and HTTP errors", () => {
    expectProviderError(
      () => adapter.parseCompletion(ok({ choices: [{ message: { refusal: "no" } }] })),
      "refused",
    );
    expectProviderError(
      () =>
        adapter.parseCompletion(
          ok({ choices: [{ message: { content: "{" }, finish_reason: "length" }] }),
        ),
      "truncated",
    );
    expectProviderError(
      () => adapter.parseCompletion(status(401, { error: { message: "bad key" } })),
      "auth",
    );
    const limited = expectProviderError(
      () =>
        adapter.parseCompletion(
          status(429, { error: { message: "slow down" } }, { "retry-after": "3" }),
        ),
      "rate_limit",
    );
    expect(limited.retryAfterMs).toBe(3000);
    expect(limited.retryable).toBe(true);
    expectProviderError(() => adapter.parseCompletion(status(503, "upstream")), "server");
    expectProviderError(
      () => adapter.parseCompletion(status(404, { error: { message: "no model" } })),
      "bad_request",
    );
    // Groq: the model's JSON came out malformed; retrying usually works.
    const malformed = expectProviderError(
      () =>
        adapter.parseCompletion(
          status(400, {
            error: { message: "Failed to validate JSON.", code: "json_validate_failed" },
          }),
        ),
      "server",
    );
    expect(malformed.retryable).toBe(true);
    expectProviderError(() => adapter.parseCompletion(ok({ choices: [] })), "invalid_response");
  });

  it("lists models", () => {
    expect(adapter.parseListModels(ok({ data: [{ id: "b" }, { id: "a" }, { nope: 1 }] }))).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("OpenAI-compatible adapter", () => {
  it("uses json_object and max_tokens by default and detects local servers", () => {
    const adapter = createAdapter(
      config({
        id: "lm",
        kind: "openai_compatible",
        model: "qwen",
        base_url: "http://127.0.0.1:1234/v1/",
        max_output_tokens: 500,
      }),
    );
    const body = adapter.buildCompletion(request).body as Record<string, unknown>;
    expect(body["response_format"]).toEqual({ type: "json_object" });
    expect(body["max_tokens"]).toBe(500);
    expect(body).not.toHaveProperty("max_completion_tokens");
    expect(adapter.baseUrl).toBe("http://127.0.0.1:1234/v1");
    expect(adapter.isLocal).toBe(true);
    expect(adapter.auth).toEqual({ type: "bearer", optional: true });
  });

  it("omits response_format when json_mode is none", () => {
    const adapter = createAdapter(
      config({
        id: "lm",
        kind: "openai_compatible",
        model: "x",
        base_url: "https://gw.example.com/v1",
        json_mode: "none",
      }),
    );
    expect(adapter.buildCompletion(request).body).not.toHaveProperty("response_format");
  });
});

describe("Anthropic adapter", () => {
  const adapter = createAdapter(
    config({ id: "an", kind: "anthropic", model: "anthropic-model", temperature: 0.2 }),
  );

  it("builds a Messages request with output_config structured output", () => {
    const built = adapter.buildCompletion(request);
    expect(built.path).toBe("/v1/messages");
    expect(built.headers).toEqual({ "anthropic-version": ANTHROPIC_VERSION });
    expect(built.body).toEqual({
      model: "anthropic-model",
      max_tokens: 2048,
      system: "SYSTEM",
      messages: [{ role: "user", content: "USER" }],
      temperature: 0.2,
      output_config: { format: { type: "json_schema", schema: { type: "object" } } },
    });
    expect(adapter.auth).toEqual({ type: "header", name: "x-api-key", optional: false });
  });

  it("joins text blocks and reads usage", () => {
    const parsed = adapter.parseCompletion(
      ok({
        model: "anthropic-model",
        stop_reason: "end_turn",
        content: [
          { type: "text", text: '{"a":' },
          { type: "text", text: "1}" },
        ],
        usage: { input_tokens: 7, output_tokens: 3 },
      }),
    );
    expect(parsed.text).toBe('{"a":1}');
    expect(parsed.usage).toEqual({ inputTokens: 7, outputTokens: 3 });
  });

  it("classifies max_tokens, refusal and error bodies", () => {
    expectProviderError(
      () =>
        adapter.parseCompletion(
          ok({ stop_reason: "max_tokens", content: [{ type: "text", text: "{" }] }),
        ),
      "truncated",
    );
    expectProviderError(
      () => adapter.parseCompletion(ok({ stop_reason: "refusal", content: [] })),
      "refused",
    );
    const err = expectProviderError(
      () =>
        adapter.parseCompletion(
          status(529, {
            type: "error",
            error: { type: "overloaded_error", message: "Overloaded" },
          }),
        ),
      "server",
    );
    expect(err.message).toContain("Overloaded");
  });

  it("can disable structured output for older models", () => {
    const legacy = createAdapter(
      config({ id: "an", kind: "anthropic", model: "old", json_mode: "none" }),
    );
    expect(legacy.buildCompletion(request).body).not.toHaveProperty("output_config");
  });
});

describe("Gemini adapter", () => {
  const adapter = createAdapter(config({ id: "ge", kind: "gemini", model: "models/gemini-test" }));

  it("builds generateContent with JSON mode and never puts the key in the URL", () => {
    const built = adapter.buildCompletion(request);
    expect(built.path).toBe("/models/gemini-test:generateContent");
    expect(built.path).not.toContain("key=");
    expect(built.body).toEqual({
      systemInstruction: { parts: [{ text: "SYSTEM" }] },
      contents: [{ role: "user", parts: [{ text: "USER" }] }],
      generationConfig: { responseMimeType: "application/json" },
    });
    expect(adapter.auth).toEqual({ type: "header", name: "x-goog-api-key", optional: false });
  });

  it("skips thought parts and counts thinking tokens as output", () => {
    const parsed = adapter.parseCompletion(
      ok({
        candidates: [
          {
            finishReason: "STOP",
            content: {
              parts: [{ text: "thinking…", thought: true }, { text: "{}" }],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2, thoughtsTokenCount: 10 },
        modelVersion: "gemini-test-001",
      }),
    );
    expect(parsed).toEqual({
      text: "{}",
      model: "gemini-test-001",
      usage: { inputTokens: 4, outputTokens: 12 },
    });
  });

  it("classifies blocked prompts, safety stops and truncation", () => {
    expectProviderError(
      () => adapter.parseCompletion(ok({ promptFeedback: { blockReason: "SAFETY" } })),
      "refused",
    );
    expectProviderError(
      () => adapter.parseCompletion(ok({ candidates: [{ finishReason: "PROHIBITED_CONTENT" }] })),
      "refused",
    );
    expectProviderError(
      () =>
        adapter.parseCompletion(
          ok({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [] } }] }),
        ),
      "truncated",
    );
  });

  it("lists only generateContent-capable models", () => {
    const models = adapter.parseListModels(
      ok({
        models: [
          { name: "models/embed", supportedGenerationMethods: ["embedContent"] },
          { name: "models/gemini-b", supportedGenerationMethods: ["generateContent"] },
        ],
      }),
    );
    expect(models).toEqual(["gemini-b"]);
  });
});

describe("plain-text output on cloud adapters", () => {
  it("drops every JSON mode when text is requested", () => {
    const text = { ...request, outputFormat: "text" as const };
    expect(
      createAdapter(config({ id: "oa", kind: "openai", model: "m" })).buildCompletion(text).body,
    ).not.toHaveProperty("response_format");
    expect(
      createAdapter(config({ id: "an", kind: "anthropic", model: "m" })).buildCompletion(text).body,
    ).not.toHaveProperty("output_config");
    expect(
      createAdapter(config({ id: "ge", kind: "gemini", model: "m" })).buildCompletion(text).body,
    ).toMatchObject({ generationConfig: {} });
  });
});

describe("Ollama adapter", () => {
  const adapter = createAdapter(config({ id: "ol", kind: "ollama", model: "llama3.2" }));

  it("is local by default and passes the JSON schema as format", () => {
    expect(adapter.isLocal).toBe(true);
    expect(adapter.auth).toEqual({ type: "none" });
    const built = adapter.buildCompletion(request);
    expect(built.path).toBe("/api/chat");
    expect(built.body).toMatchObject({
      model: "llama3.2",
      stream: false,
      format: { type: "object" },
    });
  });

  it("uses a low default temperature for repeatable corrections", () => {
    expect(adapter.buildCompletion(request).body).toMatchObject({ options: { temperature: 0.2 } });
    const custom = createAdapter(
      config({ id: "ol", kind: "ollama", model: "x", temperature: 0.7 }),
    );
    expect(custom.buildCompletion(request).body).toMatchObject({ options: { temperature: 0.7 } });
  });

  it("disables reasoning by default and allows opting in", () => {
    expect(adapter.buildCompletion(request).body).toMatchObject({ think: false });
    const thinker = createAdapter(config({ id: "ol", kind: "ollama", model: "x", thinking: true }));
    expect(thinker.buildCompletion(request).body).toMatchObject({ think: true });
  });

  it("keeps the model warm for 5 minutes by default and can unload immediately", () => {
    expect(adapter.buildCompletion(request).body).toMatchObject({ keep_alive: "300s" });
    const cold = createAdapter(
      config({ id: "ol", kind: "ollama", model: "x", keep_alive_seconds: 0 }),
    );
    expect(cold.buildCompletion(request).body).toMatchObject({ keep_alive: 0 });
  });

  it("requests plain text without any JSON format, streamed on demand", () => {
    const built = adapter.buildCompletion({ ...request, outputFormat: "text" }, { stream: true });
    expect(built.body).not.toHaveProperty("format");
    expect(built.body).toMatchObject({ stream: true });
    expect(adapter.buildCompletion(request).body).toMatchObject({ stream: false });
  });

  it("parses stream lines: deltas, the final line, errors and truncation", () => {
    const parse = adapter.parseStreamLine?.bind(adapter);
    if (parse === undefined) throw new Error("Ollama adapter must stream");
    expect(parse('{"message":{"content":"Bon"},"done":false}')).toEqual({ delta: "Bon" });
    expect(
      parse(
        '{"model":"m","message":{"content":""},"done":true,"prompt_eval_count":5,"eval_count":2}',
      ),
    ).toEqual({ delta: "", final: { model: "m", usage: { inputTokens: 5, outputTokens: 2 } } });
    expectProviderError(() => parse('{"error":"model crashed"}'), "server");
    expectProviderError(() => parse('{"done":true,"done_reason":"length"}'), "truncated");
    expectProviderError(() => parse("not json"), "invalid_response");
  });

  it("treats a remote Ollama server as cloud", () => {
    const remote = createAdapter(
      config({ id: "ol", kind: "ollama", model: "x", base_url: "https://ollama.example.com" }),
    );
    expect(remote.isLocal).toBe(false);
  });

  it("parses message content, counts and truncation", () => {
    expect(
      adapter.parseCompletion(
        ok({ model: "llama3.2", message: { content: "{}" }, prompt_eval_count: 3, eval_count: 2 }),
      ),
    ).toEqual({ text: "{}", model: "llama3.2", usage: { inputTokens: 3, outputTokens: 2 } });
    expectProviderError(
      () => adapter.parseCompletion(ok({ done_reason: "length", message: { content: "" } })),
      "truncated",
    );
    expectProviderError(
      () => adapter.parseCompletion(status(404, { error: "model 'x' not found" })),
      "bad_request",
    );
  });
});
