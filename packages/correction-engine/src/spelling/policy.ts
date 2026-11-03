import type { GrammarIssue } from "@typely/schemas";
import { matchCase } from "../rules/types.ts";

/**
 * When a misspelling may be fixed without asking (ADR-014: a false fix costs more trust than
 * a missed one). Shared by every spell checker, so the word list and Windows behave alike.
 */

/** Words shorter than this are too ambiguous to judge ("teh" is in the curated list). */
const MIN_LENGTH = 4;
/** Typo-shaped edits are applied from this length on. */
const MIN_FIX_LENGTH = 5;

/** Letter rows of QWERTY and AZERTY, the layouts of the supported languages. */
const KEYBOARD_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm", "azertyuiop", "qsdfghjklm", "wxcvbn"];

/** Whether two letters sit next to each other on QWERTY or AZERTY. */
function adjacentKeys(x: string | undefined, y: string | undefined): boolean {
  if (x === undefined || y === undefined) return false;
  return KEYBOARD_ROWS.some((row) => {
    const i = row.indexOf(x);
    return i !== -1 && (row[i - 1] === y || row[i + 1] === y);
  });
}

export type EditKind = "transposition" | "insertion" | "deletion" | "substitution";

export interface Edit {
  kind: EditKind;
  /** Index (in code points) of the first difference. */
  index: number;
  /**
   * The edit has the shape of a typo rather than of a different word: two adjacent letters
   * swapped, a doubled letter added or dropped, or an extra letter whose key sits next to a
   * neighbouring letter's ("imlpressive"); never on the first letter. "keyring" → "keying"
   * or "Ollama" → "Llama" are one edit but not typo-shaped, so they are only suggested.
   */
  typoShaped: boolean;
}

/** The single edit turning `from` into `to`, or undefined if they differ by more than one. */
export function singleEdit(from: string, to: string): Edit | undefined {
  if (from === to) return undefined;
  const a = [...from];
  const b = [...to];
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const restEqual = (x: string[], xi: number, y: string[], yi: number) =>
    x.slice(xi).join("") === y.slice(yi).join("");
  const doubled = (x: string[], at: number) => x[at] === x[at - 1] || x[at] === x[at + 1];
  if (a.length === b.length) {
    // One letter for another can be a different word ("blocklisted"/"blacklisted").
    if (restEqual(a, i + 1, b, i + 1)) return { kind: "substitution", index: i, typoShaped: false };
    if (a[i] === b[i + 1] && a[i + 1] === b[i] && restEqual(a, i + 2, b, i + 2))
      return { kind: "transposition", index: i, typoShaped: true };
    return undefined;
  }
  if (a.length + 1 === b.length && restEqual(a, i, b, i + 1))
    return { kind: "insertion", index: i, typoShaped: i > 0 && doubled(b, i) };
  if (a.length === b.length + 1 && restEqual(a, i + 1, b, i)) {
    // A stray consonant inside the word, next to a neighbouring key. Not the last letter
    // ("bundler"/"bundle") and not a vowel ("Salut"/"Slut"): those often make another word.
    const strayKey =
      i < a.length - 1 &&
      !"aeiouy".includes(a[i] ?? "") &&
      (adjacentKeys(a[i], a[i - 1]) || adjacentKeys(a[i], a[i + 1]));
    return { kind: "deletion", index: i, typoShaped: i > 0 && (doubled(a, i) || strayKey) };
  }
  return undefined;
}

function markCount(word: string): number {
  return (word.normalize("NFD").match(/\p{M}/gu) ?? []).length;
}

export function stripAccents(word: string): string {
  return word.normalize("NFD").replace(/\p{M}/gu, "");
}

/**
 * Whether a token is worth checking: long enough, not an acronym, not a name in the middle
 * of a sentence, and not part of an identifier, path or number.
 */
export function shouldCheck(text: string, offset: number, word: string): boolean {
  if ([...word].length < MIN_LENGTH || /\d/.test(word)) return false;
  if (word.length > 1 && word === word.toUpperCase() && word !== word.toLowerCase()) return false;
  const rest = word.slice(1);
  if (rest !== rest.toLowerCase()) return false; // camelCase, McDonald
  const before = text.slice(0, offset);
  const after = text.charAt(offset + word.length);
  const prev = before.charAt(before.length - 1);
  if (/[\w._/\\@#$%&=+-]/u.test(prev) || /[\w_/\\@#$%&=+]/u.test(after)) return false;
  if (after === "." && /^\.\w/u.test(text.slice(offset + word.length))) return false; // file.txt
  const first = word.charAt(0);
  if (first !== first.toLowerCase()) {
    // Capitalised: only at the start of a sentence, where it is not a proper noun.
    const lead = before.trimEnd();
    if (lead !== "" && !/[.!?…:;"«»“”\n]$/u.test(lead)) return false;
  }
  return true;
}

export interface SpellingOptions {
  language: string;
  /** A replacement the checker itself is sure of (Windows' "replace" action). */
  confident?: string;
}

/**
 * Builds the issue for a misspelled `word` at `offset`, given the checker's candidates.
 * - one accent-only candidate ("interessant" → "intéressant"), a confident replacement, or a
 *   single nearby candidate under the length rules: one replacement, applied automatically;
 * - several plausible candidates: listed, never applied;
 * - no nearby candidate (unknown names, jargon): no issue at all.
 */
export function spellingIssue(
  text: string,
  offset: number,
  word: string,
  candidates: readonly string[],
  options: SpellingOptions,
): GrammarIssue | undefined {
  if (!shouldCheck(text, offset, word)) return undefined;
  const lower = word.toLowerCase();
  const unique = [...new Set(candidates.map((c) => c.toLowerCase()))].filter((c) => c !== lower);
  // Adding missing accents ("interessant" → "intéressant"); never removing them.
  const accentOnly = unique.filter(
    (c) => stripAccents(c) === stripAccents(lower) && markCount(c) > markCount(lower),
  );
  const near = unique.filter((c) => singleEdit(lower, c) !== undefined);
  const length = [...word].length;
  const base = {
    offset,
    length: word.length,
    category: "spelling" as const,
    source: "local" as const,
    rule_id: `${options.language.split("-")[0]?.toUpperCase() ?? "UND"}_SPELLING`,
  };

  let fix: string | undefined;
  if (options.confident !== undefined && options.confident.toLowerCase() !== lower) {
    fix = options.confident.toLowerCase();
  } else if (accentOnly.length === 1) {
    fix = accentOnly[0];
  } else if (accentOnly.length === 0 && length >= MIN_FIX_LENGTH) {
    const typos = near.filter((c) => singleEdit(lower, c)?.typoShaped === true);
    if (typos.length === 1) fix = typos[0];
  }
  if (fix !== undefined) {
    const replacement = matchCase(word, fix);
    return {
      ...base,
      message: `Spelling: “${word}” → “${replacement}”.`,
      replacements: [replacement],
      severity: "error",
    };
  }

  const plausible = [...new Set([...accentOnly, ...near])].map((c) => matchCase(word, c));
  if (plausible.length === 0) return undefined;
  // Never a single replacement here: issues with exactly one are applied automatically.
  return {
    ...base,
    message:
      plausible.length === 1
        ? `Possible misspelling: did you mean “${plausible[0]}”?`
        : `Possible misspelling of “${word}”.`,
    replacements: plausible.length === 1 ? [] : plausible.slice(0, 3),
    severity: "suggestion",
  };
}
