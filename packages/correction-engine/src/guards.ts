import type { DiffSegment, Operation, ResultWarning } from "@typely/schemas";
import { detectLanguage } from "./detect.ts";
import type { LanguageRegistry } from "./languages/registry.ts";
import type { OperationDefinition } from "./operations.ts";
import { charEditRatio } from "./text/diff.ts";
import { findProtectedSpans } from "./text/protected.ts";

const NUMBER = /\d+(?:[.,:/h]\d+)*/g;
const CONFIDENT = 0.6;

export interface GuardInput {
  operation: OperationDefinition;
  original: string;
  corrected: string;
  sourceLanguage: string;
  sourceConfidence: number;
  targetLanguage?: string;
  changes: readonly DiffSegment[];
}

/**
 * Post-checks on AI output. They never modify the text — they warn the user, because a
 * silent "fix" of a model mistake could itself be wrong.
 */
export function runGuards(input: GuardInput, registry: LanguageRegistry): ResultWarning[] {
  const warnings: ResultWarning[] = [];
  const { operation, original, corrected } = input;

  const lost = findProtectedSpans(original)
    // A translation may legitimately translate hashtags; everything else must survive verbatim.
    .filter((s) => operation.id !== "translate" || s.kind !== "hashtag")
    .map((s) => s.text)
    .filter((token) => !corrected.includes(token));
  if (lost.length > 0) {
    warnings.push({
      code: "protected_token_lost",
      message: `These elements were changed or removed: ${unique(lost).slice(0, 5).join(", ")}`,
    });
  }

  if (!REFORMATS_NUMBERS.has(operation.id)) {
    const missingNumbers = unique(original.match(NUMBER) ?? []).filter(
      (n) => !corrected.includes(n),
    );
    if (missingNumbers.length > 0) {
      warnings.push({
        code: "protected_token_lost",
        message: `These numbers no longer appear: ${missingNumbers.slice(0, 5).join(", ")}`,
      });
    }
  }

  const output = detectLanguage(corrected, registry);
  const expected = operation.id === "translate" ? input.targetLanguage : input.sourceLanguage;
  const sourceIsReliable = operation.id === "translate" || input.sourceConfidence >= CONFIDENT;
  if (
    expected !== undefined &&
    expected !== "und" &&
    sourceIsReliable &&
    output.language !== "und" &&
    output.confidence >= CONFIDENT &&
    baseCode(output.language) !== baseCode(expected)
  ) {
    warnings.push({
      code: "language_changed",
      message: `The result appears to be in '${output.language}' instead of '${expected}'.`,
    });
  }

  if (operation.maxChangeRatio !== undefined && original.length >= 40) {
    const ratio = charEditRatio(original, corrected);
    if (ratio > operation.maxChangeRatio) {
      warnings.push({
        code: "excessive_changes",
        message: `About ${Math.round(ratio * 100)}% of the text was changed; review before replacing.`,
      });
    }
  }
  return warnings;
}

/** Operations allowed to legitimately rewrite number formats or drop redundant numbers. */
const REFORMATS_NUMBERS: ReadonlySet<Operation> = new Set(["translate", "prompt"]);

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function baseCode(code: string): string {
  return code.split("-")[0] ?? code;
}
