import { describe, expect, it } from "vitest";
import { createSpeller, WindowsSpeller, type WindowsSpellResult } from "../src/spelling.ts";

// What Windows' French spell checker returned for this sentence on the development machine.
const text = "Je voudrais savoir si vous avez recu mon message, c'etait interessant.";
const at = (word: string) => text.indexOf(word);
const windowsFrench: WindowsSpellResult = {
  language_tag: "fr-FR",
  errors: [
    {
      offset: at("recu"),
      length: 4,
      action: "suggest",
      suggestions: ["reçu", "recul", "reçue", "reçus", "reçut"],
    },
    { offset: at("etait"), length: 5, action: "replace", replacement: "était", suggestions: [] },
    {
      offset: at("interessant"),
      length: 11,
      action: "suggest",
      suggestions: ["intéressant", "intéressante", "intéressants"],
    },
  ],
};

describe("WindowsSpeller", () => {
  it("adds missing accents and takes Windows' confident replacements", async () => {
    const speller = new WindowsSpeller(async () => windowsFrench);
    const issues = await speller.check(text, "fr");
    expect(issues.map((i) => [text.slice(i.offset, i.offset + i.length), i.replacements])).toEqual([
      ["recu", ["reçu"]],
      ["etait", ["était"]],
      ["interessant", ["intéressant"]],
    ]);
    expect(issues.every((i) => i.rule_id === "FR_SPELLING" && i.category === "spelling")).toBe(
      true,
    );
  });

  it("does nothing for a language Windows does not have", async () => {
    const speller = new WindowsSpeller(async () => ({ language_tag: null, errors: [] }));
    expect(await speller.check("Some text", "de")).toEqual([]);
  });

  it("the desktop speller covers English without Windows and French through it", async () => {
    const calls: string[] = [];
    const speller = createSpeller(async (_text, language) => {
      calls.push(language);
      return language === "fr" ? windowsFrench : { language_tag: null, errors: [] };
    });
    const en = await speller.check("A catchy readme file, imlpressive and dynamic.", "en");
    expect(en.map((i) => i.replacements)).toEqual([["impressive"]]);
    const fr = await speller.check(text, "fr");
    expect(fr).toHaveLength(3);
    expect(calls).toEqual(["en", "fr"]);
  });
});
