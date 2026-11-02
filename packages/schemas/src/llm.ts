import { z } from "zod";
import { ISSUE_CATEGORIES, IssueCategorySchema } from "./common.ts";

/**
 * The JSON contract every LLM must return. Kept deliberately small and loose on values
 * (e.g. detected_language is any string) — the engine normalises and enriches it.
 */
export const LlmCorrectionOutputSchema = z.object({
  corrected_text: z.string(),
  detected_language: z.string(),
  explanation: z.array(
    z.object({
      original: z.string(),
      corrected: z.string(),
      reason: z.string(),
      // Models occasionally invent categories; map unknown ones to "other" instead of failing.
      category: z.string().transform((c) => {
        const parsed = IssueCategorySchema.safeParse(c.toLowerCase());
        return parsed.success ? parsed.data : "other";
      }),
    }),
  ),
  confidence: z.number().transform((n) => Math.min(1, Math.max(0, n))),
  warnings: z.array(z.string()),
});
export type LlmCorrectionOutput = z.output<typeof LlmCorrectionOutputSchema>;

/**
 * JSON Schema sent to providers that support schema-constrained output. It stays within
 * the subset accepted by OpenAI strict mode, Anthropic `output_config.format` and Ollama
 * `format`: every property required, `additionalProperties: false`, no numeric or string
 * constraints. Kept in sync with {@link LlmCorrectionOutputSchema} by a unit test.
 */
export const LLM_OUTPUT_JSON_SCHEMA = {
  type: "object",
  properties: {
    corrected_text: { type: "string", description: "The full transformed text." },
    detected_language: {
      type: "string",
      description: "ISO 639-1 code of the input text's main language.",
    },
    explanation: {
      type: "array",
      items: {
        type: "object",
        properties: {
          original: { type: "string" },
          corrected: { type: "string" },
          reason: { type: "string" },
          category: { type: "string", enum: [...ISSUE_CATEGORIES] },
        },
        required: ["original", "corrected", "reason", "category"],
        additionalProperties: false,
      },
    },
    confidence: { type: "number", description: "Between 0 and 1." },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: ["corrected_text", "detected_language", "explanation", "confidence", "warnings"],
  additionalProperties: false,
} as const;
