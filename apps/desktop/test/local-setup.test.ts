import { CorrectionEngine } from "@typely/correction-engine";
import { OllamaAdapter } from "@typely/provider-adapters";
import { EngineSettingsSchema } from "@typely/schemas";
import { describe, expect, it } from "vitest";
import {
  FAST_PROVIDER_ID,
  headProvider,
  isSmallModel,
  planLocalSetup,
  QUALITY_PROVIDER_ID,
} from "../src/local-setup.ts";

const GB = 1024 ** 3;
const empty = EngineSettingsSchema.parse({});

describe("planLocalSetup", () => {
  it("routes fix to the warm 1B and everything else to the unloaded 4B", () => {
    const plan = planLocalSetup(empty, ["gemma3:1b", "gemma3:4b", "llama3.2:latest"], 32 * GB);
    expect(plan.missing).toEqual([]);
    expect(plan.lowMemory).toBe(false);
    const engine = EngineSettingsSchema.parse(plan.engine);
    expect(engine.provider_order).toEqual([QUALITY_PROVIDER_ID, FAST_PROVIDER_ID]);
    expect(engine.operation_providers).toEqual({ fix: FAST_PROVIDER_ID });
    const fast = engine.providers.find((p) => p.id === FAST_PROVIDER_ID);
    const quality = engine.providers.find((p) => p.id === QUALITY_PROVIDER_ID);
    expect(fast).toMatchObject({ model: "gemma3:1b", kind: "ollama" });
    expect(fast?.keep_alive_seconds).toBeUndefined();
    expect(quality).toMatchObject({
      model: "gemma3:4b",
      keep_alive_seconds: 0,
      timeout_ms: 90_000,
    });

    // What the adapters will actually send to Ollama.
    const body = (id: string) => {
      const config = engine.providers.find((p) => p.id === id);
      if (config === undefined) throw new Error(id);
      return new OllamaAdapter(config).buildCompletion({
        system: "s",
        user: "u",
        suggestedMaxOutputTokens: 10,
        outputFormat: "text",
      }).body as Record<string, unknown>;
    };
    expect(body(FAST_PROVIDER_ID)).toMatchObject({ keep_alive: "300s", think: false });
    expect(body(FAST_PROVIDER_ID)["format"]).toBeUndefined();
    expect(body(QUALITY_PROVIDER_ID)).toMatchObject({ keep_alive: 0 });

    // The engine accepts the result as-is.
    expect(
      () =>
        new CorrectionEngine({
          settings: engine,
          transport: { send: async () => ({ status: 500, headers: {}, body: undefined }) },
        }),
    ).not.toThrow();
  });

  it("offers only the 1B on low-memory machines and reports missing models", () => {
    const plan = planLocalSetup(empty, ["gemma3:1b"], 16 * GB);
    expect(plan.lowMemory).toBe(true);
    expect(plan.missing).toEqual([]);
    expect(plan.engine.providers.map((p) => p.id)).toEqual([FAST_PROVIDER_ID]);

    const none = planLocalSetup(empty, [], 32 * GB);
    expect(none.missing).toEqual(["gemma3:1b", "gemma3:4b"]);
    expect(none.engine.providers).toEqual([]);
    expect(none.engine.operation_providers).toEqual({});
  });

  it("keeps other providers after the local ones and drops stale local routes", () => {
    const engine = EngineSettingsSchema.parse({
      providers: [
        { id: "anthropic", kind: "anthropic", label: "A", model: "anthropic-model" },
        { id: FAST_PROVIDER_ID, kind: "ollama", label: "old", model: "gemma3:1b" },
      ],
      provider_order: [FAST_PROVIDER_ID, "anthropic"],
      operation_providers: { translate: "anthropic", fix: FAST_PROVIDER_ID },
    });
    const plan = planLocalSetup(engine, ["gemma3:4b"], 32 * GB);
    const parsed = EngineSettingsSchema.parse(plan.engine);
    expect(parsed.providers.map((p) => p.id)).toEqual([QUALITY_PROVIDER_ID, "anthropic"]);
    expect(parsed.provider_order).toEqual([QUALITY_PROVIDER_ID, "anthropic"]);
    expect(parsed.operation_providers).toEqual({ translate: "anthropic" });
    expect(plan.missing).toEqual(["gemma3:1b"]);
  });
});

describe("model routing helpers", () => {
  it("recognises 1–2B models", () => {
    for (const m of ["gemma3:1b", "qwen3.5:2b-q4_K_M", "llama3.2:1b", "qwen2.5:0.5b"])
      expect(isSmallModel(m), m).toBe(true);
    for (const m of ["gemma3:4b", "llama3.2", "gemma3:12b", "anthropic-model"])
      expect(isSmallModel(m), m).toBe(false);
  });

  it("finds the provider an operation goes to first", () => {
    const plan = planLocalSetup(empty, ["gemma3:1b", "gemma3:4b"], 32 * GB);
    const engine = EngineSettingsSchema.parse(plan.engine);
    expect(headProvider(engine, "fix", engine.providers)?.id).toBe(FAST_PROVIDER_ID);
    expect(headProvider(engine, "rewrite", engine.providers)?.id).toBe(QUALITY_PROVIDER_ID);
    const onlyFast = engine.providers.filter((p) => p.id === FAST_PROVIDER_ID);
    expect(headProvider(engine, "rewrite", onlyFast)?.id).toBe(FAST_PROVIDER_ID);
  });
});
