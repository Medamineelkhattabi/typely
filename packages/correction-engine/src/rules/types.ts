import type { IssueCategory } from "@typely/schemas";
import type { LanguageProfile } from "../languages/types.ts";

export interface RuleContext {
  text: string;
  language: string;
  profile: LanguageProfile | undefined;
}

export interface RuleMatch {
  offset: number;
  length: number;
  message: string;
  replacements: readonly string[];
  /** Overrides the rule's category (e.g. phrase entries carry their own). */
  category?: IssueCategory;
}

export interface LocalRule {
  id: string;
  category: IssueCategory;
  severity: "error" | "warning" | "suggestion";
  find(context: RuleContext): RuleMatch[];
}

/** Collects regex matches as rule matches. `build` returns undefined to skip a match. */
export function matchAll(
  text: string,
  pattern: RegExp,
  build: (match: RegExpExecArray) => RuleMatch | undefined,
): RuleMatch[] {
  if (!pattern.global) throw new Error(`Rule pattern ${pattern} must be global`);
  const results: RuleMatch[] = [];
  pattern.lastIndex = 0;
  for (let m = pattern.exec(text); m !== null; m = pattern.exec(text)) {
    if (m[0].length === 0) pattern.lastIndex++;
    const result = build(m);
    if (result !== undefined) results.push(result);
  }
  return results;
}

/** Applies the casing of `original` (Capitalised or UPPER) to `replacement`. */
export function matchCase(original: string, replacement: string): string {
  if (
    original.length > 1 &&
    original === original.toUpperCase() &&
    original !== original.toLowerCase()
  ) {
    return replacement.toUpperCase();
  }
  const first = original.charAt(0);
  if (first !== first.toLowerCase() && first === first.toUpperCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}
