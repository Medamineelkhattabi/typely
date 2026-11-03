import type { GrammarIssue } from "@typely/schemas";
import { mergeIssues } from "../rules/index.ts";
import { spellingIssue } from "./policy.ts";

/**
 * A spell checker for Layer 1. Implementations return issues built with `spellingIssue`, so
 * every checker follows the same auto-apply policy. Offsets are UTF-16 code units.
 */
export interface Speller {
  check(
    text: string,
    language: string,
    signal?: AbortSignal,
  ): Promise<GrammarIssue[]> | GrammarIssue[];
}

/** Runs several spellers; when they flag the same span, the earlier one wins. */
export function combineSpellers(...spellers: Speller[]): Speller {
  return {
    async check(text, language, signal) {
      let merged: GrammarIssue[] = [];
      for (const speller of spellers) {
        const issues = await speller.check(text, language, signal);
        merged = mergeIssues(merged, issues);
      }
      return merged;
    },
  };
}

interface Dictionary {
  /** Every valid word, lower-cased. */
  valid: Set<string>;
  /** Lower-case dictionary words that may be offered as a correction. */
  suggestable: Set<string>;
}

/** Decodes the front-coded list written by scripts/build-wordlist.ts. */
export function decodeWordList(source: string): Dictionary {
  const valid = new Set<string>();
  const suggestable = new Set<string>();
  let previous = "";
  for (const line of source.split("\n")) {
    if (line === "") continue;
    const noSuggest = line.startsWith("!");
    const body = noSuggest ? line.slice(1) : line;
    const shared = Number(body.charAt(0));
    const word = previous.slice(0, shared) + body.slice(1);
    previous = word;
    const lower = word.toLowerCase();
    valid.add(lower);
    // Proper nouns ("Paris") are accepted but never suggested for a lower-case word.
    if (!noSuggest && word === lower) suggestable.add(word);
  }
  return { valid, suggestable };
}

const ALPHABET = "abcdefghijklmnopqrstuvwxyz'";
const WORD = /\p{L}+(?:['’]\p{L}+)*/gu;

function singleEdits(word: string): Set<string> {
  const edits = new Set<string>();
  for (let i = 0; i <= word.length; i++) {
    const head = word.slice(0, i);
    const tail = word.slice(i);
    if (tail.length > 0) edits.add(head + tail.slice(1));
    if (tail.length > 1) edits.add(head + tail.charAt(1) + tail.charAt(0) + tail.slice(2));
    for (const letter of ALPHABET) {
      if (tail.length > 0) edits.add(head + letter + tail.slice(1));
      edits.add(head + letter + tail);
    }
  }
  edits.delete(word);
  return edits;
}

/**
 * English spell checking against SCOWL (US and British spellings), entirely local.
 * The list is decoded on first use, not when the app starts.
 */
export class WordListSpeller implements Speller {
  readonly #load: () => string;
  readonly #languages: readonly string[];
  #dictionary: Dictionary | undefined;

  constructor(source: string | (() => string), languages: readonly string[] = ["en"]) {
    this.#load = typeof source === "string" ? () => source : source;
    this.#languages = languages;
  }

  #dict(): Dictionary {
    this.#dictionary ??= decodeWordList(this.#load());
    return this.#dictionary;
  }

  isValid(word: string): boolean {
    const { valid } = this.#dict();
    const lower = word.toLowerCase().replaceAll("’", "'");
    if (valid.has(lower)) return true;
    // Possessives and plurals of known words: SCOWL lacks some ("integrations").
    for (const ending of ["'s", "s", "es"]) {
      if (
        lower.endsWith(ending) &&
        lower.length - ending.length >= 3 &&
        valid.has(lower.slice(0, -ending.length))
      )
        return true;
    }
    return false;
  }

  check(text: string, language: string): GrammarIssue[] {
    const base = language.split("-")[0] ?? "";
    // Undetermined text (often a single selected word) is checked as English when it is
    // plain ASCII; the strict fix policy keeps unaccented foreign words safe.
    const asEnglish =
      base === "und" && this.#languages.includes("en") && /^[\p{ASCII}’]*$/u.test(text);
    if (!asEnglish && !this.#languages.includes(base)) return [];
    const ruleLanguage = asEnglish ? "en" : language;
    const { suggestable } = this.#dict();
    const issues: GrammarIssue[] = [];
    for (const match of text.matchAll(WORD)) {
      const word = match[0];
      // The list is ASCII: accented words are foreign ("réunion") and are left alone.
      if (/[^\p{ASCII}’]/u.test(word) || this.isValid(word)) continue;
      const lower = word.toLowerCase().replaceAll("’", "'");
      const candidates = [...singleEdits(lower)].filter((c) => suggestable.has(c));
      const issue = spellingIssue(text, match.index, word, candidates, {
        language: ruleLanguage,
      });
      if (issue !== undefined) issues.push(issue);
    }
    return issues;
  }
}
