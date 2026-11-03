import {
  combineSpellers,
  type Speller,
  spellingIssue,
  WordListSpeller,
} from "@typely/correction-engine";
import enWords from "@typely/correction-engine/data/en-words.txt?raw";
import type { GrammarIssue } from "@typely/schemas";

/** The Rust `SpellResult`: Windows' findings, offsets in UTF-16 code units. */
export interface WindowsSpellResult {
  language_tag?: string | null;
  errors: {
    offset: number;
    length: number;
    action: "replace" | "suggest" | "delete" | "none";
    replacement?: string;
    suggestions: string[];
  }[];
}

export type SpellCheckCall = (text: string, language: string) => Promise<WindowsSpellResult>;

/**
 * The Windows spell checker (via Rust), for every language installed in Windows. Its
 * suggestions go through the engine's shared policy, so it fixes no more eagerly than the
 * word list does; Windows' own "replace" verdict counts as a confident fix.
 */
export class WindowsSpeller implements Speller {
  readonly #call: SpellCheckCall;

  constructor(call: SpellCheckCall) {
    this.#call = call;
  }

  async check(text: string, language: string): Promise<GrammarIssue[]> {
    if (language === "und") return [];
    const result = await this.#call(text, language);
    if (result.language_tag === undefined || result.language_tag === null) return [];
    const issues: GrammarIssue[] = [];
    for (const error of result.errors) {
      if (error.action !== "replace" && error.action !== "suggest") continue;
      const word = text.slice(error.offset, error.offset + error.length);
      const issue = spellingIssue(text, error.offset, word, error.suggestions, {
        language,
        ...(error.action === "replace" && error.replacement !== undefined
          ? { confident: error.replacement }
          : {}),
      });
      if (issue !== undefined) issues.push(issue);
    }
    return issues;
  }
}

/** Layer-1 spell checking for the desktop: bundled English list first, then Windows. */
export function createSpeller(call: SpellCheckCall): Speller {
  return combineSpellers(new WordListSpeller(enWords), new WindowsSpeller(call));
}
