import { describe, expect, it } from "vitest";
import {
  CorrectionRequestSchema,
  EngineSettingsSchema,
  ISSUE_CATEGORIES,
  LLM_OUTPUT_JSON_SCHEMA,
  LlmCorrectionOutputSchema,
  ProviderConfigSchema,
} from "../src/index.ts";

describe("CorrectionRequestSchema", () => {
  it("accepts a minimal fix request", () => {
    expect(CorrectionRequestSchema.parse({ operation: "fix", text: "hello" }).operation).toBe(
      "fix",
    );
  });

  it("requires target_language for translate", () => {
    const result = CorrectionRequestSchema.safeParse({ operation: "translate", text: "bonjour" });
    expect(result.success).toBe(false);
    expect(
      CorrectionRequestSchema.safeParse({
        operation: "translate",
        text: "bonjour",
        target_language: "en",
      }).success,
    ).toBe(true);
  });

  it("rejects whitespace-only text, unknown keys and bad language codes", () => {
    expect(CorrectionRequestSchema.safeParse({ operation: "fix", text: "   " }).success).toBe(
      false,
    );
    expect(
      CorrectionRequestSchema.safeParse({ operation: "fix", text: "x", extra: 1 }).success,
    ).toBe(false);
    expect(
      CorrectionRequestSchema.safeParse({ operation: "fix", text: "x", language: "French" })
        .success,
    ).toBe(false);
    expect(
      CorrectionRequestSchema.safeParse({ operation: "fix", text: "x", language: "en-GB" }).success,
    ).toBe(true);
  });
});

describe("LlmCorrectionOutputSchema", () => {
  const valid = {
    corrected_text: "Bonjour",
    detected_language: "fr",
    explanation: [
      { original: "Bonjours", corrected: "Bonjour", reason: "Orthographe", category: "SPELLING" },
    ],
    confidence: 1.4,
    warnings: [],
  };

  it("normalises categories and clamps confidence", () => {
    const parsed = LlmCorrectionOutputSchema.parse(valid);
    expect(parsed.explanation[0]?.category).toBe("spelling");
    expect(parsed.confidence).toBe(1);
  });

  it("maps unknown categories to other", () => {
    const parsed = LlmCorrectionOutputSchema.parse({
      ...valid,
      explanation: [{ ...valid.explanation[0], category: "vibes" }],
    });
    expect(parsed.explanation[0]?.category).toBe("other");
  });

  it("stays in sync with the JSON schema sent to providers", () => {
    expect([...LLM_OUTPUT_JSON_SCHEMA.required].sort()).toEqual(
      Object.keys(LlmCorrectionOutputSchema.shape).sort(),
    );
    expect(Object.keys(LLM_OUTPUT_JSON_SCHEMA.properties).sort()).toEqual(
      Object.keys(LlmCorrectionOutputSchema.shape).sort(),
    );
    const item = LLM_OUTPUT_JSON_SCHEMA.properties.explanation.items;
    expect([...item.required].sort()).toEqual(Object.keys(item.properties).sort());
    expect(item.properties.category.enum).toEqual([...ISSUE_CATEGORIES]);
  });

  it("uses only keywords accepted by every strict structured-output provider", () => {
    const forbidden = [
      "minimum",
      "maximum",
      "minLength",
      "maxLength",
      "pattern",
      "format",
      "minItems",
      "maxItems",
    ];
    const json = JSON.stringify(LLM_OUTPUT_JSON_SCHEMA);
    for (const keyword of forbidden) expect(json).not.toContain(`"${keyword}"`);
    // Every object must forbid additional properties (OpenAI strict / Anthropic requirement).
    const objects = json.match(/"type":"object"/g)?.length ?? 0;
    const closed = json.match(/"additionalProperties":false/g)?.length ?? 0;
    expect(closed).toBe(objects);
  });
});

describe("EngineSettingsSchema", () => {
  const provider = {
    id: "main",
    kind: "anthropic",
    label: "Anthropic",
    model: "anthropic-model",
  } as const;

  it("applies privacy-first defaults", () => {
    const settings = EngineSettingsSchema.parse({});
    expect(settings.privacy.cloud_processing_allowed).toBe(false);
    expect(settings.privacy.store_history).toBe(false);
    expect(settings.default_mode).toBe("hybrid");
    expect(settings.limits.max_input_chars).toBe(20_000);
  });

  it("defaults consent to false per provider", () => {
    expect(ProviderConfigSchema.parse(provider).consent_granted).toBe(false);
  });

  it("rejects duplicate ids, unknown order entries and compatible providers without base_url", () => {
    expect(EngineSettingsSchema.safeParse({ providers: [provider, provider] }).success).toBe(false);
    expect(
      EngineSettingsSchema.safeParse({ providers: [provider], provider_order: ["nope"] }).success,
    ).toBe(false);
    expect(
      EngineSettingsSchema.safeParse({
        providers: [{ id: "lm", kind: "openai_compatible", label: "LM", model: "x" }],
      }).success,
    ).toBe(false);
  });

  it("rejects non-http base URLs", () => {
    expect(
      ProviderConfigSchema.safeParse({ ...provider, base_url: "file:///etc/passwd" }).success,
    ).toBe(false);
  });
});
