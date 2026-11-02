import type { IssueCategory } from "@typely/schemas";
import type { LocalRule } from "../rules/types.ts";

export interface PhraseCorrection {
  /** Must use the `g`, `i` and `u` flags. Word boundaries are expressed with lookarounds. */
  pattern: RegExp;
  /** One replacement = safe to auto-apply; several = user must choose. */
  replacements: readonly string[];
  message: string;
  category: IssueCategory;
}

/**
 * Everything Typely knows about a language. Adding a language means adding a profile and
 * registering it — no engine changes.
 */
export interface LanguageProfile {
  code: string;
  name: string;
  nativeName: string;
  direction: "ltr" | "rtl";
  script: "latin" | "arabic";
  /** Frequent function words used for detection. Avoid words shared with other profiles. */
  stopwords: ReadonlySet<string>;
  /** Extra detection signal: words containing these characters count as half a hit. */
  markerChars?: RegExp;
  /** Detection signal from apostrophe forms (French elision, English contractions). */
  apostropheForm?: "elision-prefix" | "contraction-suffix";
  /** Words that may legitimately repeat ("nous nous", "vous vous"). Lower case. */
  legitimateRepeats: ReadonlySet<string>;
  /** Abbreviations followed by a period that do not end a sentence. Lower case, no period. */
  abbreviations: ReadonlySet<string>;
  /** Unambiguous misspellings: lower-case wrong form → correct form. */
  misspellings: ReadonlyMap<string, string>;
  phrases: readonly PhraseCorrection[];
  /** Language-specific rules, in addition to the shared ones. */
  rules: readonly LocalRule[];
  /** Guidance injected into LLM prompts. */
  promptGuidance: string;
}
