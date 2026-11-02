import { type LlmCorrectionOutput, LlmCorrectionOutputSchema } from "@typely/schemas";

export type ParseOutcome =
  | { ok: true; value: LlmCorrectionOutput }
  | { ok: false; problem: string };

/**
 * Extracts the first JSON object from model output, tolerating Markdown fences and
 * leading/trailing prose that some models add despite instructions.
 */
export function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const candidate = fenced?.[1] ?? trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end <= start) throw new SyntaxError("No JSON object found in the response");
    return JSON.parse(candidate.slice(start, end + 1));
  }
}

export function parseLlmOutput(raw: string): ParseOutcome {
  let json: unknown;
  try {
    json = extractJson(raw);
  } catch (error) {
    return {
      ok: false,
      problem: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const parsed = LlmCorrectionOutputSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return { ok: false, problem: `Schema mismatch: ${issues}` };
  }
  if (parsed.data.corrected_text.trim().length === 0) {
    return { ok: false, problem: "corrected_text is empty" };
  }
  return { ok: true, value: parsed.data };
}
