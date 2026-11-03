import type { GrammarIssue } from "@typely/schemas";
import type { LanguageProfile } from "../languages/types.ts";
import { findProtectedSpans, overlapsAny } from "../text/protected.ts";
import { COMMON_RULES } from "./common.ts";
import type { LocalRule } from "./types.ts";

export interface LocalCheckOptions {
  disabledRules?: ReadonlySet<string>;
}

/**
 * Layer 1: runs shared and language-specific rules, drops matches touching protected
 * spans, and removes overlaps (earlier rules in priority order win).
 */
export function runLocalRules(
  text: string,
  language: string,
  profile: LanguageProfile | undefined,
  options: LocalCheckOptions = {},
): GrammarIssue[] {
  const protectedSpans = findProtectedSpans(text);
  const rules: LocalRule[] = [...COMMON_RULES, ...(profile?.rules ?? [])];
  const accepted: GrammarIssue[] = [];

  for (const rule of rules) {
    if (options.disabledRules?.has(rule.id)) continue;
    for (const match of rule.find({ text, language, profile })) {
      const start = match.offset;
      const end = match.offset + match.length;
      if (overlapsAny(protectedSpans, start, end)) continue;
      if (accepted.some((a) => start < a.offset + a.length && end > a.offset)) continue;
      accepted.push({
        offset: start,
        length: match.length,
        message: match.message,
        category: match.category ?? rule.category,
        replacements: [...match.replacements],
        source: "local",
        rule_id:
          rule.id === "PHRASE" || rule.id === "MISSPELLING"
            ? `${language.toUpperCase()}_${rule.id}`
            : rule.id,
        severity: rule.severity,
      });
    }
  }
  return accepted.sort((a, b) => a.offset - b.offset);
}

/** Merges issue lists, keeping the first issue when spans overlap. */
export function mergeIssues(
  primary: readonly GrammarIssue[],
  secondary: readonly GrammarIssue[],
): GrammarIssue[] {
  const merged = [...primary];
  for (const issue of secondary) {
    const end = issue.offset + issue.length;
    if (!merged.some((m) => issue.offset < m.offset + m.length && end > m.offset))
      merged.push(issue);
  }
  return merged.sort((a, b) => a.offset - b.offset);
}

export interface AppliedFixes {
  text: string;
  applied: GrammarIssue[];
}

/**
 * Applies issues that have exactly one replacement. Issues with several candidate
 * replacements need a human decision and are skipped, as are issues marked
 * `auto_fix: false` and overlapping issues.
 */
export function applyFixes(text: string, issues: readonly GrammarIssue[]): AppliedFixes {
  const candidates = issues
    .filter((i) => i.replacements.length === 1 && i.auto_fix !== false)
    .sort((a, b) => a.offset - b.offset);
  const applied: GrammarIssue[] = [];
  let lastEnd = -1;
  for (const issue of candidates) {
    if (issue.offset < lastEnd) continue;
    if (issue.offset + issue.length > text.length) continue;
    applied.push(issue);
    lastEnd = issue.offset + issue.length;
  }
  let result = text;
  for (const issue of [...applied].reverse()) {
    result =
      result.slice(0, issue.offset) +
      (issue.replacements[0] ?? "") +
      result.slice(issue.offset + issue.length);
  }
  return { text: result, applied };
}

export interface LocalFixResult {
  text: string;
  /** Applied fixes as explanations, with fragments taken from the text of the pass that found them. */
  applied: Array<{ original: string; issue: GrammarIssue }>;
}

/**
 * Applies local fixes repeatedly (max 3 passes) because one fix can reveal another:
 * "teh the" → "the the" → "the", or "هل وصلك ?" → "هل وصلك ؟" → "هل وصلك؟".
 */
export function fixLocally(
  text: string,
  language: string,
  profile: LanguageProfile | undefined,
  options: LocalCheckOptions = {},
  initialIssues?: readonly GrammarIssue[],
): LocalFixResult {
  let current = text;
  const applied: LocalFixResult["applied"] = [];
  for (let pass = 0; pass < 3; pass++) {
    const issues =
      pass === 0 && initialIssues !== undefined
        ? initialIssues
        : runLocalRules(current, language, profile, options);
    const result = applyFixes(current, issues);
    if (result.applied.length === 0) break;
    for (const issue of result.applied) {
      applied.push({ original: current.slice(issue.offset, issue.offset + issue.length), issue });
    }
    current = result.text;
  }
  return { text: current, applied };
}
