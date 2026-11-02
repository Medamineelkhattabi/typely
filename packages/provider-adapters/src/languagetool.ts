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
    return matches.flatMap((match) => toIssue(match, text.length));
  }
}

function toIssue(match: unknown, textLength: number): GrammarIssue[] {
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
  return [
    {
      offset,
      length,
      message,
      category,
      replacements,
      source: "languagetool",
      rule_id: typeof rule["id"] === "string" ? `LT:${rule["id"]}` : "LT:UNKNOWN",
      severity:
        issueType === "misspelling" || issueType === "grammar"
          ? "error"
          : issueType === "style"
            ? "suggestion"
            : "warning",
    },
  ];
}
