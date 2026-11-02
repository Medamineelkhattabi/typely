import { type LocalRule, matchAll, matchCase, type RuleMatch } from "./types.ts";

const WORD_TOKEN = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu;

export const repeatedWord: LocalRule = {
  id: "REPEATED_WORD",
  category: "repetition",
  severity: "error",
  find: ({ text, profile }) =>
    matchAll(
      text,
      /(?<![\p{L}\p{M}\p{N}])([\p{L}\p{M}]+)([ \t]+)\1(?![\p{L}\p{M}\p{N}])/giu,
      (m) => {
        const word = m[1] ?? "";
        if (profile?.legitimateRepeats.has(word.toLowerCase())) return undefined;
        return {
          offset: m.index,
          length: m[0].length,
          message: `Repeated word: “${word}”.`,
          replacements: [word],
        };
      },
    ),
};

export const multipleSpaces: LocalRule = {
  id: "MULTIPLE_SPACES",
  category: "whitespace",
  severity: "suggestion",
  find: ({ text }) =>
    matchAll(text, /(?<=\S) {2,}(?=\S)/g, (m) => ({
      offset: m.index,
      length: m[0].length,
      message: "Multiple spaces between words.",
      replacements: [" "],
    })),
};

export const spaceBeforeCommaOrPeriod: LocalRule = {
  id: "SPACE_BEFORE_COMMA_OR_PERIOD",
  category: "punctuation",
  severity: "warning",
  find: ({ text }) =>
    // Not before an ellipsis ("wait ...") — that is a stylistic choice.
    matchAll(text, /(?<=[\p{L}\p{N}]) +(?=,|\.(?!\.))/gu, (m) => ({
      offset: m.index,
      length: m[0].length,
      message: "No space before a comma or a period.",
      replacements: [""],
    })),
};

export const missingSpaceAfterPunctuation: LocalRule = {
  id: "MISSING_SPACE_AFTER_PUNCTUATION",
  category: "punctuation",
  severity: "warning",
  find: ({ text }) => [
    ...matchAll(text, /(?<=\p{L}[\p{M}]*)([,;،؛])(?=\p{L})/gu, (m) => ({
      offset: m.index,
      length: 1,
      message: "Missing space after punctuation.",
      replacements: [`${m[1] ?? ""} `],
    })),
    ...matchAll(text, /(?<=\p{L}[\p{M}]*)([?!؟])(?=\p{L})/gu, (m) => ({
      offset: m.index,
      length: 1,
      message: "Missing space after punctuation.",
      replacements: [`${m[1] ?? ""} `],
    })),
    // "done.Next" — lower-case before, Capitalised word after; avoids file names and decimals.
    ...matchAll(text, /(?<=\p{Ll}{2})\.(?=\p{Lu}\p{Ll})/gu, (m) => ({
      offset: m.index,
      length: 1,
      message: "Missing space after the period.",
      replacements: [". "],
    })),
  ],
};

export const sentenceCapitalization: LocalRule = {
  id: "SENTENCE_CAPITALIZATION",
  category: "capitalization",
  severity: "warning",
  find: ({ text, profile }) => {
    if (profile?.script !== "latin") return [];
    const results: RuleMatch[] = [];
    const startsText = /^\s*(\p{Ll}[\p{L}\p{M}'’-]*)/u.exec(text);
    if (startsText?.[1] !== undefined && isPlainLowercaseWord(startsText[1])) {
      const word = startsText[1];
      results.push(capitalize(text.indexOf(word), word));
    }
    for (const m of text.matchAll(/(?<=(\S*)[.!?])(\s+)(\p{Ll}[\p{L}\p{M}'’-]*)/gu)) {
      const before = m[1] ?? "";
      const word = m[3] ?? "";
      const punctuationIndex = m.index - 1;
      const punctuation = text.charAt(punctuationIndex);
      if (!isPlainLowercaseWord(word)) continue;
      if (
        punctuation === "." &&
        isNonTerminalPeriod(text, punctuationIndex, before, profile.abbreviations)
      ) {
        continue;
      }
      results.push(capitalize(m.index + (m[2]?.length ?? 0), word));
    }
    return results;
  },
};

function isPlainLowercaseWord(word: string): boolean {
  // "iPhone", "eBay", "npm-run": mixed case or technical tokens are left alone.
  return word === word.toLowerCase() && !/\d/.test(word);
}

function isNonTerminalPeriod(
  text: string,
  index: number,
  before: string,
  abbreviations: ReadonlySet<string>,
): boolean {
  if (text.charAt(index - 1) === ".") return true; // ellipsis
  const token = before.replace(/^[("'«“]+/u, "").toLowerCase();
  if (token.length <= 1) return true; // initials "J. smith", list markers "a."
  if (/^\d+$/.test(token)) return true; // numbered list "1. item"
  return abbreviations.has(token);
}

function capitalize(offset: number, word: string): RuleMatch {
  const first = word.charAt(0);
  return {
    offset,
    length: first.length,
    message: "A sentence starts with a capital letter.",
    replacements: [first.toUpperCase()],
  };
}

export const misspelling: LocalRule = {
  id: "MISSPELLING",
  category: "spelling",
  severity: "error",
  find: ({ text, profile }) => {
    if (profile === undefined || profile.misspellings.size === 0) return [];
    return matchAll(text, WORD_TOKEN, (m) => {
      const correct = profile.misspellings.get(m[0].toLowerCase());
      return correct === undefined
        ? undefined
        : {
            offset: m.index,
            length: m[0].length,
            message: `Spelling: “${m[0]}” → “${matchCase(m[0], correct)}”.`,
            replacements: [matchCase(m[0], correct)],
          };
    });
  },
};

export const phrase: LocalRule = {
  id: "PHRASE",
  category: "grammar",
  severity: "error",
  find: ({ text, profile }) =>
    (profile?.phrases ?? []).flatMap((entry) =>
      matchAll(text, entry.pattern, (m) => {
        const replacements = entry.replacements.map((r) =>
          matchCase(
            m[0],
            r.replace(/\$(\d)/g, (_, group: string) => m[Number(group)] ?? ""),
          ),
        );
        if (replacements.length === 1 && replacements[0] === m[0]) return undefined;
        return {
          offset: m.index,
          length: m[0].length,
          message: entry.message,
          replacements,
          category: entry.category,
        };
      }),
    ),
};

/** Rules applied to every language, in priority order. */
export const COMMON_RULES: readonly LocalRule[] = [
  phrase,
  misspelling,
  repeatedWord,
  missingSpaceAfterPunctuation,
  spaceBeforeCommaOrPeriod,
  multipleSpaces,
  sentenceCapitalization,
];
