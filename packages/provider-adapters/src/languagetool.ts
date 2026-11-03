import type { GrammarIssue, IssueCategory } from "@typely/schemas";
import { ensureOk, isObject } from "./adapters/shared.ts";
import { ProviderError } from "./errors.ts";
import type { Transport } from "./types.ts";

const ISSUE_TYPE_CATEGORY: Readonly<Record<string, IssueCategory>> = {
  misspelling: "spelling",
  grammar: "grammar",
  typographical: "typography",
  style: "style",
  whitespace: "whitespace",
  duplication: "repetition",
  inconsistency: "style",
};

const RULE_CATEGORY: Readonly<Record<string, IssueCategory>> = {
  PUNCTUATION: "punctuation",
  CASING: "capitalization",
  TYPOS: "spelling",
  TYPOGRAPHY: "typography",
  GRAMMAR: "grammar",
  REDUNDANCY: "concision",
  STYLE: "style",
  CONFUSED_WORDS: "spelling",
};

/**
 * Which LanguageTool findings may be applied without asking (ADR-020). Measured on real
 * text: grammar, agreement and confusion rules are reliable ("I has" → "have", "vien" →
 * "viens", "a" → "à"); spacing, casing and comma rules produced false positives on real
 * documents ("id" → "ID", "fr" → "for"), and Typely's own rules already cover spacing and
 * capitalisation. Spelling stays with Typely's dictionary, which is stricter with names.
 */
const AUTO_FIX_CATEGORIES = new Set([
  "GRAMMAR",
  "CAT_GRAMMAIRE",
  "AGREEMENT",
  "CONFUSED_WORDS",
  "CAT_HOMONYMES_PARONYMES",
  "TYPOS",
  "MISC",
  "PUNCTUATION",
]);
const NEVER_AUTO_RULE =
  /SPELL|MORFOLOGIK|HUNSPELL|WORD_REPEAT|COMMA|VIRGULE|UNPAIRED|WHITESPACE|SPACE|CASING|UPPERCASE/;
/**
 * Two automatic grammar fixes on adjacent words may contradict ("This are my friend" gets
 * "This" → "These" and "are" → "is"): then neither is applied. Fixes further apart ("tu vien
 * demain, je les ai vu": viens, vus) or of different kinds ("I has a apple": has → have,
 * a → an) are independent.
 */
const CONFLICT_GAP = 3;
const GRAMMAR_CATEGORIES = new Set(["GRAMMAR", "CAT_GRAMMAIRE", "AGREEMENT"]);

/** Rules whose id matches NEVER_AUTO_RULE but are reliable ("isnt" → "isn't"). */
const ALWAYS_AUTO_RULE = new Set(["EN_CONTRACTION_SPELLING"]);

export function isSafeLanguageToolFix(match: {
  categoryId: string;
  ruleId: string;
  issueType: string;
  matched: string;
  /** The text before the match, to recognise a capitalised word in mid-sentence. */
  before: string;
}): boolean {
  if (!AUTO_FIX_CATEGORIES.has(match.categoryId)) return false;
  if (NEVER_AUTO_RULE.test(match.ruleId) && !ALWAYS_AUTO_RULE.has(match.ruleId)) return false;
  // A capitalised word in mid-sentence is usually a name or a label ("the Replace button").
  const lead = match.before.trimEnd();
  if (/^\p{Lu}/u.test(match.matched) && lead !== "" && !/[.!?:\n"«“]$/u.test(lead)) return false;
  if (match.issueType === "style" || match.issueType === "typographical") return false;
  // Two-letter tokens are usually abbreviations or language codes ("fr" → "for").
  if (match.categoryId === "TYPOS" && match.matched.trim().length < 3) return false;
  return true;
}

/** Language codes LanguageTool needs a variant for to enable spell checking. */
const LANGUAGE_VARIANTS: Readonly<Record<string, string>> = {
  en: "en-US",
  pt: "pt-PT",
  de: "de-DE",
};

export interface LanguageToolClientOptions {
  transport: Transport;
  /** Endpoint id resolved by the transport (base URL + optional premium API key). */
  endpointId: string;
  /** Premium user name; the API key is attached by the transport as a form field. */
  username?: string;
  timeoutMs?: number;
}

/** Client for the LanguageTool HTTP API `/v2/check` (self-hosted or languagetool.org). */
export class LanguageToolClient {
  readonly #options: LanguageToolClientOptions;

  constructor(options: LanguageToolClientOptions) {
    this.#options = options;
  }

  async check(text: string, language: string, signal?: AbortSignal): Promise<GrammarIssue[]> {
    const { transport, endpointId, username, timeoutMs } = this.#options;
    const ltLanguage = language === "und" ? "auto" : (LANGUAGE_VARIANTS[language] ?? language);
    const response = await transport.send(
      endpointId,
      {
        method: "POST",
        path: "/v2/check",
        encoding: "form",
        body: {
          text,
          language: ltLanguage,
          ...(username === undefined ? {} : { username }),
        },
        timeoutMs: timeoutMs ?? 15_000,
      },
      signal,
    );
    const body = ensureOk(endpointId, response);
    const matches = body["matches"];
    if (!Array.isArray(matches)) {
      throw new ProviderError(
        "invalid_response",
        endpointId,
        "LanguageTool response has no matches",
      );
    }
    const found = matches.flatMap((match) => toIssue(match, text));
    const automaticGrammar = found.filter(
      (f) =>
        GRAMMAR_CATEGORIES.has(f.categoryId) &&
        f.issue.auto_fix !== false &&
        f.issue.replacements.length === 1,
    );
    for (const f of automaticGrammar) {
      const conflict = automaticGrammar.some((other) => {
        if (other === f) return false;
        const [first, second] =
          other.issue.offset < f.issue.offset ? [other.issue, f.issue] : [f.issue, other.issue];
        return second.offset - (first.offset + first.length) <= CONFLICT_GAP;
      });
      if (conflict) f.issue.auto_fix = false;
    }
    return found.map((f) => f.issue);
  }
}

function toIssue(match: unknown, text: string): { issue: GrammarIssue; categoryId: string }[] {
  const textLength = text.length;
  if (!isObject(match)) return [];
  const { offset, length, message } = match;
  if (typeof offset !== "number" || typeof length !== "number" || typeof message !== "string")
    return [];
  if (offset < 0 || length < 0 || offset + length > textLength) return [];
  const rule = isObject(match["rule"]) ? match["rule"] : {};
  const issueType = typeof rule["issueType"] === "string" ? rule["issueType"] : "";
  const ruleCategoryId =
    isObject(rule["category"]) && typeof rule["category"]["id"] === "string"
      ? rule["category"]["id"]
      : "";
  const category = RULE_CATEGORY[ruleCategoryId] ?? ISSUE_TYPE_CATEGORY[issueType] ?? "other";
  const replacements = Array.isArray(match["replacements"])
    ? match["replacements"]
        .map((r) => (isObject(r) && typeof r["value"] === "string" ? r["value"] : undefined))
        .filter((r): r is string => r !== undefined)
        .slice(0, 5)
    : [];
  const ruleId = typeof rule["id"] === "string" ? rule["id"] : "UNKNOWN";
  const safe = isSafeLanguageToolFix({
    categoryId: ruleCategoryId,
    ruleId,
    issueType,
    matched: text.slice(offset, offset + length),
    before: text.slice(Math.max(0, offset - 40), offset),
  });
  return [
    {
      categoryId: ruleCategoryId,
      issue: {
        offset,
        length,
        message,
        category,
        replacements,
        source: "languagetool",
        rule_id: `LT:${ruleId}`,
        ...(safe ? {} : { auto_fix: false }),
        severity:
          issueType === "misspelling" || issueType === "grammar"
            ? "error"
            : issueType === "style"
              ? "suggestion"
              : "warning",
      },
    },
  ];
}
