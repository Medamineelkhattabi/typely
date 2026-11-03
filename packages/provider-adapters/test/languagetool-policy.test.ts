import { describe, expect, it } from "vitest";
import { isSafeLanguageToolFix, LanguageToolClient, type Transport } from "../src/index.ts";

/** A LanguageTool match as the server returns it (shape taken from LanguageTool 6.6). */
function match(
  text: string,
  fragment: string,
  replacement: string,
  categoryId: string,
  ruleId: string,
  issueType = "grammar",
  from = 0,
) {
  const offset = text.indexOf(fragment, from);
  return {
    message: ruleId,
    offset,
    length: fragment.length,
    replacements: [{ value: replacement }],
    rule: { id: ruleId, issueType, category: { id: categoryId } },
  };
}

async function check(text: string, matches: unknown[]) {
  const transport: Transport = {
    send: async () => ({ status: 200, headers: {}, body: { matches } }),
  };
  const client = new LanguageToolClient({ transport, endpointId: "languagetool" });
  return client.check(text, "en");
}

const automatic = (issues: Awaited<ReturnType<typeof check>>) =>
  issues
    .filter((i) => i.auto_fix !== false && i.replacements.length === 1)
    .map((i) => i.replacements[0]);

describe("LanguageTool auto-fix policy", () => {
  it("applies grammar and confusion fixes", () => {
    for (const [categoryId, ruleId] of [
      ["GRAMMAR", "BASE_FORM"],
      ["CAT_GRAMMAIRE", "TU_VERBE"],
      ["CAT_HOMONYMES_PARONYMES", "A_A_ACCENT2"],
      ["TYPOS", "IT_IS"],
      ["MISC", "EN_A_VS_AN"],
      ["TYPOS", "EN_CONTRACTION_SPELLING"],
    ] as const)
      expect(
        isSafeLanguageToolFix({
          categoryId,
          ruleId,
          issueType: "grammar",
          matched: "has",
          before: "I ",
        }),
        ruleId,
      ).toBe(true);
  });

  it("only suggests spelling, spacing, casing, commas and style", () => {
    for (const [categoryId, ruleId, issueType] of [
      ["TYPOS", "MORFOLOGIK_RULE_EN_US", "misspelling"],
      ["TYPOS", "FR_SPELLING_RULE", "misspelling"],
      ["TYPOGRAPHY", "WHITESPACE_RULE", "whitespace"],
      ["CASING", "ID_CASING", "misspelling"],
      ["PUNCTUATION", "COMMA_COMPOUND_SENTENCE", "typographical"],
      ["STYLE", "SOME_STYLE_RULE", "style"],
      ["BRITISH_ENGLISH", "AFTERWARDS_US", "locale-violation"],
      ["MISC", "ENGLISH_WORD_REPEAT_RULE", "duplication"],
    ] as const)
      expect(
        isSafeLanguageToolFix({ categoryId, ruleId, issueType, matched: "word", before: "a " }),
        ruleId,
      ).toBe(false);
  });

  it("does not touch abbreviations or capitalised words in mid-sentence", () => {
    expect(
      isSafeLanguageToolFix({
        categoryId: "TYPOS",
        ruleId: "FR",
        issueType: "misspelling",
        matched: "fr",
        before: "codes ",
      }),
    ).toBe(false);
    expect(
      isSafeLanguageToolFix({
        categoryId: "GRAMMAR",
        ruleId: "PREPOSITION_VERB",
        issueType: "grammar",
        matched: "Replace",
        before: "The end-to-end ",
      }),
    ).toBe(false);
    expect(
      isSafeLanguageToolFix({
        categoryId: "GRAMMAR",
        ruleId: "THIS_NNS",
        issueType: "grammar",
        matched: "This",
        before: "Done. ",
      }),
    ).toBe(true);
  });

  it("holds back contradicting grammar fixes on adjacent words, and only those", async () => {
    const a = "This are my friend.";
    expect(
      automatic(
        await check(a, [
          match(a, "This", "These", "GRAMMAR", "THIS_NNS"),
          match(a, "are", "is", "GRAMMAR", "PLURAL_VERB_AFTER_THIS"),
        ]),
      ),
    ).toEqual([]);

    const b = "I has a apple.";
    expect(
      automatic(
        await check(b, [
          match(b, "has", "have", "GRAMMAR", "BASE_FORM"),
          match(b, "a", "an", "MISC", "EN_A_VS_AN", "misspelling", 4),
        ]),
      ),
    ).toEqual(["have", "an"]);

    const c = "Il faut que tu vien demain, je les ai vu.";
    expect(
      automatic(
        await check(c, [
          match(c, "vien", "viens", "CAT_GRAMMAIRE", "TU_VERBE"),
          match(c, "vu", "vus", "CAT_GRAMMAIRE", "AUX_AVOIR"),
        ]),
      ),
    ).toEqual(["viens", "vus"]);
  });
});
