import type {
  ProviderHttpRequest,
  ProviderHttpResponse,
  Transport,
} from "@typely/provider-adapters";
import type { EngineSettingsInput } from "@typely/schemas";
import { CorrectionResultSchema } from "@typely/schemas";
import { describe, expect, it, vi } from "vitest";
import { CorrectionEngine, EngineError } from "../src/index.ts";

type Handler = (
  request: ProviderHttpRequest,
) => ProviderHttpResponse | Promise<ProviderHttpResponse>;

function fakeTransport(handlers: Record<string, Handler>) {
  const calls: Array<{ endpointId: string; request: ProviderHttpRequest }> = [];
  const transport: Transport = {
    send: async (endpointId, request, signal) => {
      calls.push({ endpointId, request });
      if (signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
      const handler = handlers[endpointId];
      if (handler === undefined) throw new Error(`No handler for ${endpointId}`);
      return handler(request);
    },
  };
  return { transport, calls };
}

const llm = (output: Record<string, unknown>) => ({
  corrected_text: "",
  detected_language: "fr",
  explanation: [],
  confidence: 0.95,
  warnings: [],
  ...output,
});
const ollamaReply = (content: string): ProviderHttpResponse => ({
  status: 200,
  headers: {},
  body: { model: "llama-test", message: { content }, prompt_eval_count: 100, eval_count: 40 },
});
const anthropicReply = (content: string): ProviderHttpResponse => ({
  status: 200,
  headers: {},
  body: {
    model: "anthropic-model",
    stop_reason: "end_turn",
    content: [{ type: "text", text: content }],
    usage: { input_tokens: 50, output_tokens: 20 },
  },
});

// JSON output keeps these tests on the structured path; plain-text mode has its own tests.
const localProvider = {
  id: "local",
  kind: "ollama",
  label: "Ollama",
  model: "llama-test",
  output_format: "json",
} as const;
const cloudProvider = {
  id: "anthropic",
  kind: "anthropic",
  label: "Anthropic",
  model: "anthropic-model",
  consent_granted: true,
} as const;
const noSleep = { sleep: async () => {} };

function engine(settings: EngineSettingsInput, handlers: Record<string, Handler>) {
  const fake = fakeTransport(handlers);
  return {
    engine: new CorrectionEngine({ settings, transport: fake.transport, chain: noSleep }),
    calls: fake.calls,
  };
}

describe("CorrectionEngine — local mode", () => {
  it("fixes with deterministic rules only and makes no network call", async () => {
    const { engine: e, calls } = engine({ default_mode: "local" }, {});
    const result = await e.run({
      operation: "fix",
      text: "i think teh the report is ready , thanks",
    });
    expect(result.corrected_text).toBe("I think the report is ready, thanks");
    expect(result.detected_language).toBe("en");
    expect(result.meta).toMatchObject({ mode: "local", layers: ["local"], attempts: [] });
    expect(result.explanation.map((e) => [e.original, e.corrected, e.source])).toEqual(
      expect.arrayContaining([
        ["teh", "the", "local"],
        ["the the", "the", "local"],
      ]),
    );
    expect(calls).toHaveLength(0);
    expect(CorrectionResultSchema.safeParse(result).success).toBe(true);
  });

  it("refuses operations that need an AI provider", async () => {
    const { engine: e } = engine({}, {});
    await expect(
      e.run({ operation: "rewrite", text: "Hello", mode: "local" }),
    ).rejects.toMatchObject({
      code: "requires_ai",
    });
  });

  it("reports no_changes for clean text", async () => {
    const { engine: e } = engine({ default_mode: "local" }, {});
    const result = await e.run({ operation: "fix", text: "Everything here is fine." });
    expect(result.warnings.map((w) => w.code)).toContain("no_changes");
    expect(result.changes).toEqual([{ type: "equal", text: "Everything here is fine." }]);
  });
});

describe("CorrectionEngine — AI modes", () => {
  it("runs an operation through a local provider and enriches the result", async () => {
    const text = "Je suis allé au marché hier avec mes amies.";
    const { engine: e, calls } = engine(
      { providers: [localProvider], default_mode: "ai" },
      {
        local: () =>
          ollamaReply(
            JSON.stringify(
              llm({
                corrected_text: "Je suis allée au marché hier avec mes amies.",
                explanation: [
                  {
                    original: "allé",
                    corrected: "allée",
                    reason: "Accord du participe passé",
                    category: "agreement",
                  },
                  { original: "hier", corrected: "hier", reason: "noise", category: "other" },
                ],
              }),
            ),
          ),
      },
    );
    const result = await e.run({ operation: "fix", text, context: { kind: "chat" } });

    expect(result.corrected_text).toBe("Je suis allée au marché hier avec mes amies.");
    expect(result.explanation).toEqual([
      {
        original: "allé",
        corrected: "allée",
        reason: "Accord du participe passé",
        category: "agreement",
        source: "ai",
      },
    ]);
    expect(result.changes).toContainEqual({ type: "delete", text: "allé" });
    expect(result.meta).toMatchObject({
      mode: "ai",
      layers: ["ai"],
      provider_id: "local",
      model: "llama-test",
      usage: { input_tokens: 100, output_tokens: 40 },
      prompt_version: "fix-2",
    });
    expect(result.warnings).toEqual([]);
    const body = calls[0]?.request.body as {
      messages: Array<{ content: string }>;
      format: unknown;
    };
    expect(body.messages[0]?.content).toContain("chat message");
    expect(body.messages[1]?.content).toContain(text);
    expect(body.format).toMatchObject({ type: "object" });
  });

  it("hybrid mode sends local hints and applies residual deterministic fixes", async () => {
    const { engine: e, calls } = engine(
      { providers: [localProvider] },
      {
        // The model fixes the misspelling but leaves a double space behind.
        local: () =>
          ollamaReply(
            JSON.stringify(
              llm({ corrected_text: "Please send the  report today.", detected_language: "en" }),
            ),
          ),
      },
    );
    const result = await e.run({ operation: "fix", text: "Please send teh report today." });
    const user =
      (calls[0]?.request.body as { messages: Array<{ content: string }> } | undefined)?.messages[1]
        ?.content ?? "";
    expect(user).toContain('"teh" → "the"');
    expect(result.corrected_text).toBe("Please send the report today.");
    expect(result.meta.layers).toEqual(["local", "ai"]);
    expect(result.explanation.some((x) => x.source === "local" && x.corrected === " ")).toBe(true);
  });

  it("uses the compact prompt for local providers and the full prompt for cloud ones", async () => {
    const reply = llm({ corrected_text: "Hello there.", detected_language: "en" });
    const { engine: e, calls } = engine(
      {
        providers: [{ ...cloudProvider, enabled: true }, localProvider],
        privacy: { cloud_processing_allowed: true },
        provider_order: ["local", "anthropic"],
      },
      {
        local: () => ({ status: 500, headers: {}, body: "boom" }),
        anthropic: () => anthropicReply(JSON.stringify(reply)),
      },
    );
    await e.run({ operation: "fix", text: "<text>Hello there</text>" });
    const localBody = calls[0]?.request.body as
      | { messages: Array<{ content: string }> }
      | undefined;
    const cloudBody = calls.at(-1)?.request.body as { system: string } | undefined;
    const localSystem = localBody?.messages[0]?.content ?? "";
    const cloudSystem = cloudBody?.system ?? "";
    expect(localSystem.length).toBeGreaterThan(0);
    expect(localSystem.length).toBeLessThan(cloudSystem.length / 2);
    expect(cloudSystem).toContain('"additionalProperties"');
  });

  it("strips delimiter tags echoed by the model", async () => {
    const { engine: e } = engine(
      { providers: [localProvider] },
      {
        local: () =>
          ollamaReply(
            JSON.stringify(
              llm({ corrected_text: "<text>\nHello there.\n</text>", detected_language: "en" }),
            ),
          ),
      },
    );
    expect((await e.run({ operation: "fix", text: "Hello there" })).corrected_text).toBe(
      "Hello there.",
    );
  });

  it("requires explicit consent before using a cloud provider", async () => {
    const { engine: e, calls } = engine(
      { providers: [cloudProvider] },
      { anthropic: () => anthropicReply("{}") },
    );
    const error = await e.run({ operation: "fix", text: "Hello there" }).catch((x: unknown) => x);
    expect(error).toBeInstanceOf(EngineError);
    expect(error).toMatchObject({ code: "consent_required", providerIds: ["anthropic"] });
    expect(calls).toHaveLength(0);

    // Global switch on but provider consent off → still blocked.
    const second = engine(
      {
        providers: [{ ...cloudProvider, consent_granted: false }],
        privacy: { cloud_processing_allowed: true },
      },
      { anthropic: () => anthropicReply("{}") },
    );
    await expect(
      second.engine.run({ operation: "fix", text: "Hello there" }),
    ).rejects.toMatchObject({
      code: "consent_required",
    });
  });

  it("skips blocked cloud providers but still uses allowed local ones", async () => {
    const { engine: e, calls } = engine(
      { providers: [cloudProvider, localProvider] },
      {
        local: () =>
          ollamaReply(
            JSON.stringify(llm({ corrected_text: "Hello there.", detected_language: "en" })),
          ),
      },
    );
    const result = await e.run({ operation: "fix", text: "Hello there" });
    expect(result.meta.provider_id).toBe("local");
    expect(calls.map((c) => c.endpointId)).toEqual(["local"]);
  });

  it("falls back to the next provider and records attempts", async () => {
    const { engine: e } = engine(
      { providers: [cloudProvider, localProvider], privacy: { cloud_processing_allowed: true } },
      {
        anthropic: () => ({
          status: 401,
          headers: {},
          body: { type: "error", error: { message: "invalid x-api-key" } },
        }),
        local: () =>
          ollamaReply(
            JSON.stringify(llm({ corrected_text: "Hello there.", detected_language: "en" })),
          ),
      },
    );
    const result = await e.run({ operation: "fix", text: "Hello there" });
    expect(result.meta.provider_id).toBe("local");
    expect(result.meta.attempts.map((a) => [a.provider_id, a.outcome, a.error_kind])).toEqual([
      ["anthropic", "error", "auth"],
      ["local", "success", undefined],
    ]);
    expect(result.warnings.map((w) => w.code)).toContain("provider_fallback");
  });

  it("repairs malformed output once, then falls back", async () => {
    let call = 0;
    const { engine: e } = engine(
      { providers: [localProvider] },
      {
        local: () => {
          call++;
          return ollamaReply(
            call === 1
              ? "Sure! Here is the fix: {corrected_text: oops"
              : JSON.stringify(llm({ corrected_text: "Fixed." })),
          );
        },
      },
    );
    const result = await e.run({ operation: "fix", text: "Fixd.", language: "en" });
    expect(result.corrected_text).toBe("Fixed.");
    expect(result.warnings.map((w) => w.code)).toContain("repaired_response");
    expect(result.meta.usage).toEqual({ input_tokens: 200, output_tokens: 80 });

    const broken = engine(
      { providers: [localProvider] },
      { local: () => ollamaReply("still not json") },
    );
    await expect(broken.engine.run({ operation: "fix", text: "Fixd." })).rejects.toMatchObject({
      code: "provider_failed",
    });
  });

  it("rejects a 'correction' that translated the text and keeps the local result", async () => {
    const text =
      "Nous devons revoir le plan de déploiement de la semaine prochaine avec toute l'équipe.";
    const { engine: e } = engine(
      { providers: [localProvider] },
      {
        local: () =>
          ollamaReply(
            JSON.stringify(
              llm({
                corrected_text:
                  "We need to review the deployment plan for next week with the whole team.",
                confidence: 0.3,
                warnings: ["The original mixes two topics."],
              }),
            ),
          ),
      },
    );
    const result = await e.run({ operation: "fix", text });
    const codes = result.warnings.map((w) => w.code);
    expect(result.corrected_text).toBe(text);
    expect(result.confidence).toBe(0.6);
    expect(codes).toEqual(
      expect.arrayContaining(["ai_rejected", "low_confidence", "model_warning"]),
    );
    expect(result.warnings.find((w) => w.code === "ai_rejected")?.message).toContain("language");
  });

  it("surfaces guard warnings on rewrite operations without rejecting them", async () => {
    const { engine: e } = engine(
      { providers: [localProvider] },
      {
        local: () =>
          ollamaReply(
            JSON.stringify(
              llm({
                corrected_text:
                  "We need to review the deployment plan for next week with the whole team.",
              }),
            ),
          ),
      },
    );
    const result = await e.run({
      operation: "rewrite",
      text: "Nous devons revoir le plan de déploiement de la semaine prochaine avec toute l'équipe.",
    });
    expect(result.corrected_text).toContain("deployment plan");
    expect(result.warnings.map((w) => w.code)).toContain("language_changed");
  });

  it("validates requests and size limits before any network call", async () => {
    const { engine: e, calls } = engine(
      { providers: [localProvider], limits: { max_input_chars: 10 } },
      {},
    );
    await expect(e.run({ operation: "translate", text: "Bonjour" })).rejects.toMatchObject({
      code: "invalid_request",
    });
    await expect(
      e.run({ operation: "fix", text: "This text is far too long" }),
    ).rejects.toMatchObject({
      code: "input_too_large",
    });
    await expect(
      e.run({ operation: "fix", text: "Hi", provider_id: "ghost" }),
    ).rejects.toMatchObject({
      code: "invalid_request",
    });
    expect(calls).toHaveLength(0);
  });

  it("reports when no provider is configured", async () => {
    const { engine: e } = engine({}, {});
    await expect(e.run({ operation: "fix", text: "Hello" })).rejects.toMatchObject({
      code: "no_provider",
    });
  });

  it("honours per-operation providers and explicit overrides", async () => {
    const second = { ...localProvider, id: "local2", label: "Second" };
    const reply = () =>
      ollamaReply(JSON.stringify(llm({ corrected_text: "Hello.", detected_language: "en" })));
    const { engine: e, calls } = engine(
      { providers: [localProvider, second], operation_providers: { rewrite: "local2" } },
      { local: reply, local2: reply },
    );
    await e.run({ operation: "rewrite", text: "Hello" });
    await e.run({ operation: "fix", text: "Hello", provider_id: "local2" });
    await e.run({ operation: "fix", text: "Hello" });
    expect(calls.map((c) => c.endpointId)).toEqual(["local2", "local2", "local"]);
  });

  it("propagates cancellation as a cancelled error", async () => {
    const controller = new AbortController();
    const { engine: e } = engine(
      { providers: [localProvider] },
      {
        local: () => {
          controller.abort();
          throw new (class extends Error {})("aborted");
        },
      },
    );
    await expect(
      e.run({ operation: "fix", text: "Hello" }, { signal: controller.signal }),
    ).rejects.toMatchObject({
      code: "cancelled",
    });
  });

  it("uses the language override and the model's detection when ours is undetermined", async () => {
    const reply = vi.fn(() =>
      ollamaReply(JSON.stringify(llm({ corrected_text: "OK.", detected_language: "Spanish" }))),
    );
    const { engine: e } = engine({ providers: [localProvider] }, { local: reply });
    expect((await e.run({ operation: "fix", text: "ok" })).detected_language).toBe("es");
    expect((await e.run({ operation: "fix", text: "ok", language: "fr" })).detected_language).toBe(
      "fr",
    );
  });
});

describe("CorrectionEngine — check and LanguageTool", () => {
  const lt = { enabled: true, base_url: "http://localhost:8081" };
  const ltReply: Handler = () => ({
    status: 200,
    headers: {},
    body: {
      matches: [
        {
          message: "Possible typo",
          offset: 0,
          length: 3,
          replacements: [{ value: "The" }],
          rule: { id: "TYPO", issueType: "misspelling" },
        },
        {
          message: "Agreement",
          offset: 4,
          length: 3,
          replacements: [{ value: "dogs" }],
          rule: { id: "AGR", issueType: "grammar" },
        },
      ],
    },
  });

  it("merges local and LanguageTool issues without calling an LLM", async () => {
    const { engine: e, calls } = engine(
      { providers: [localProvider], languagetool: lt },
      { languagetool: ltReply },
    );
    const result = await e.check("Teh dog runs to the park.");
    expect(result.issues.map((i) => i.rule_id)).toEqual(["EN_MISSPELLING", "LT:AGR"]);
    expect(calls.map((c) => c.endpointId)).toEqual(["languagetool"]);
  });

  it("degrades gracefully when LanguageTool fails", async () => {
    const { engine: e } = engine(
      { languagetool: lt },
      { languagetool: () => ({ status: 503, headers: {}, body: "down" }) },
    );
    const result = await e.check("Teh dog runs to the park.");
    expect(result.issues.map((i) => i.rule_id)).toEqual(["EN_MISSPELLING"]);
    expect(result.warnings.map((w) => w.code)).toEqual(["languagetool_unavailable"]);
  });

  it("does not send text to a remote LanguageTool without consent", async () => {
    const { engine: e, calls } = engine(
      { languagetool: { enabled: true, base_url: "https://api.languagetool.org" } },
      { languagetool: ltReply },
    );
    const result = await e.check("Teh dog runs to the park.");
    expect(calls).toHaveLength(0);
    expect(result.warnings.map((w) => w.code)).toEqual(["languagetool_unavailable"]);
  });

  it("uses LanguageTool in local fix mode", async () => {
    const { engine: e } = engine(
      { default_mode: "local", languagetool: lt },
      { languagetool: ltReply },
    );
    const result = await e.run({ operation: "fix", text: "Teh dog runs to the park." });
    expect(result.corrected_text).toBe("The dogs runs to the park.");
    expect(result.meta.layers).toEqual(["local", "languagetool"]);
    expect(result.confidence).toBe(0.8);
  });
});

describe("CorrectionEngine — provider test", () => {
  it("lists models or reports the error kind", async () => {
    const { engine: e } = engine(
      { providers: [localProvider, cloudProvider] },
      {
        local: () => ({ status: 200, headers: {}, body: { models: [{ name: "llama-test" }] } }),
        anthropic: () => ({ status: 401, headers: {}, body: { error: { message: "bad key" } } }),
      },
    );
    expect(await e.testProvider("local")).toEqual({ ok: true, models: ["llama-test"] });
    expect(await e.testProvider("anthropic")).toMatchObject({ ok: false, errorKind: "auth" });
    expect(await e.testProvider("ghost")).toMatchObject({ ok: false, errorKind: "not_configured" });
  });
});
