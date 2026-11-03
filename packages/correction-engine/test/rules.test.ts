import { describe, expect, it } from "vitest";
import {
  applyFixes,
  createDefaultRegistry,
  fixLocally,
  mergeIssues,
  NBSP,
  NNBSP,
  runLocalRules,
} from "../src/index.ts";

const registry = createDefaultRegistry();
const issues = (language: string, text: string, disabled: string[] = []) =>
  runLocalRules(text, language, registry.get(language), { disabledRules: new Set(disabled) });
const fix = (language: string, text: string) =>
  fixLocally(text, language, registry.get(language)).text;
const ruleIds = (language: string, text: string) => issues(language, text).map((i) => i.rule_id);

describe("shared rules", () => {
  it("removes repeated words but keeps legitimate repeats", () => {
    expect(fix("en", "Please send the the file")).toBe("Please send the file");
    expect(fix("fr", "Nous nous verrons demain")).toBe("Nous nous verrons demain");
    expect(fix("ar", "سأرسل الملف الملف غدا")).toBe("سأرسل الملف غدا");
  });

  it("fixes spacing around punctuation", () => {
    expect(fix("en", "Ready , set.Go now")).toBe("Ready, set. Go now");
    expect(fix("en", "Is it done?it is")).toBe("Is it done? It is");
    expect(fix("en", "Wait  for   it")).toBe("Wait for it");
  });

  it("does not touch decimals, ellipses, times, indentation or newlines", () => {
    for (const text of [
      "It costs 3,50 euros.",
      "Well ... maybe",
      "Meet at 10:30 today.",
      "Line one\n  Line two",
    ]) {
      expect(fix("en", text)).toBe(text);
    }
  });

  it("capitalises sentence starts with abbreviation, list and brand exceptions", () => {
    expect(fix("en", "this works. it really does!")).toBe("This works. It really does!");
    for (const text of [
      "See e.g. the docs.",
      "Ask Mr. smith.",
      "1. item one",
      "Wait... then go.",
      "iPhone sales grew.",
    ]) {
      expect(ruleIds("en", text)).not.toContain("SENTENCE_CAPITALIZATION");
    }
  });

  it("never modifies protected spans", () => {
    const text = "check https://example.com/teh/the?x=1 and `teh teh` and user@teh.com @teh #teh";
    const found = issues("en", text);
    expect(
      found.every((i) => text.slice(i.offset, i.offset + i.length).indexOf("http") === -1),
    ).toBe(true);
    expect(fix("en", text)).toBe(
      "Check https://example.com/teh/the?x=1 and `teh teh` and user@teh.com @teh #teh",
    );
  });

  it("applies cascading fixes over several passes", () => {
    expect(fix("en", "i think teh the report is ready")).toBe("I think the report is ready");
  });

  it("can disable rules", () => {
    expect(issues("en", "Wait  here", ["MULTIPLE_SPACES"])).toEqual([]);
  });
});

describe("English rules", () => {
  it("capitalises the pronoun I but not i.e. or identifiers", () => {
    expect(fix("en", "Yes, i'm sure i can")).toBe("Yes, I'm sure I can");
    expect(fix("en", "Use the i.e. form and the i-th index")).toBe(
      "Use the i.e. form and the i-th index",
    );
  });

  it("fixes curated misspellings preserving case", () => {
    expect(fix("en", "Teh team will recieve it TOMOROW? No, tommorow.")).toBe(
      "The team will receive it TOMORROW? No, tomorrow.",
    );
  });

  it("fixes modal + of", () => {
    expect(fix("en", "You should of told me.")).toBe("You should have told me.");
  });

  it("removes spaces before ; : ! ? but keeps emoticons", () => {
    expect(fix("en", "Really ? Yes !")).toBe("Really? Yes!");
    expect(fix("en", "Nice work :)")).toBe("Nice work :)");
  });
});

describe("French rules", () => {
  it("adds no-break spaces before double punctuation and inside guillemets", () => {
    expect(fix("fr", "Bonjour! Tu viens? Note: oui")).toBe(
      `Bonjour${NNBSP}! Tu viens${NNBSP}? Note${NBSP}: oui`,
    );
    expect(fix("fr", "Il a dit «oui» hier.")).toBe(`Il a dit «${NNBSP}oui${NNBSP}» hier.`);
  });

  it("leaves times, code and URLs alone", () => {
    for (const text of [
      "Rendez-vous à 10:30 demain.",
      "Utilise std::vector ici.",
      "Voir https://ex.com/a?b=c ici.",
    ]) {
      expect(fix("fr", text)).toBe(text);
    }
  });

  it("fixes phrases and misspellings, offering choices when ambiguous", () => {
    expect(fix("fr", "En faite, ca va. Si il pleut, c'est à dire demain")).toBe(
      "En fait, ça va. S'il pleut, c'est-à-dire demain",
    );
    expect(fix("fr", "Il est parmis nous, deja la.")).toBe("Il est parmi nous, déjà la.");
    const ambiguous = issues("fr", "quelque soit le résultat").find(
      (i) => i.rule_id === "FR_PHRASE",
    );
    expect(ambiguous?.replacements).toEqual(["quel que soit", "quelle que soit"]);
    // Two candidates: not auto-applied.
    expect(fix("fr", "Quelque soit le résultat")).toBe("Quelque soit le résultat");
  });

  it("keeps English technical terms in French text", () => {
    expect(fix("fr", "Le deploy du build est prévu, le language model aussi.")).toBe(
      "Le deploy du build est prévu, le language model aussi.",
    );
  });
});

describe("Arabic rules", () => {
  it("replaces Latin punctuation and removes spaces before Arabic punctuation", () => {
    expect(fix("ar", "سأرسل الملف الى الفريق , هل وصلك ?")).toBe(
      "سأرسل الملف إلى الفريق، هل وصلك؟",
    );
  });

  it("fixes common phrase and hamza errors", () => {
    expect(fix("ar", "انشاء الله نلتقي")).toBe("إن شاء الله نلتقي");
    expect(fix("ar", "ان شاء الله")).toBe("إن شاء الله");
    expect(fix("ar", "إن شاء الله")).toBe("إن شاء الله");
    expect(fix("ar", "انا ذاهب الان")).toBe("أنا ذاهب الآن");
  });

  it("does not apply Latin capitalisation rules", () => {
    expect(ruleIds("ar", "مرحبا. كيف الحال")).not.toContain("SENTENCE_CAPITALIZATION");
  });
});

describe("issue utilities", () => {
  it("reports UTF-16 offsets that match the text", () => {
    const text = "😀 the the end";
    const [issue] = issues("en", text).filter((i) => i.rule_id === "REPEATED_WORD");
    expect(text.slice(issue?.offset, (issue?.offset ?? 0) + (issue?.length ?? 0))).toBe("the the");
  });

  it("merges issue lists keeping the first of overlapping issues", () => {
    const local = issues("en", "teh cat");
    const lt = {
      message: "",
      category: "spelling",
      replacements: [] as string[],
      source: "languagetool",
      severity: "error",
    } as const;
    const remote = [{ ...lt, offset: 0, length: 3, rule_id: "LT:X" }];
    const other = { ...lt, offset: 4, length: 3, rule_id: "LT:Y" };
    expect(mergeIssues(local, [...remote, other]).map((i) => i.rule_id)).toEqual([
      "EN_MISSPELLING",
      "LT:Y",
    ]);
  });

  it("applies only single-replacement, non-overlapping issues", () => {
    const base = {
      message: "",
      category: "other",
      source: "local",
      rule_id: "X",
      severity: "error",
    } as const;
    const result = applyFixes("abcdef", [
      { ...base, offset: 0, length: 2, replacements: ["X"] },
      { ...base, offset: 1, length: 2, replacements: ["Y"] },
      { ...base, offset: 4, length: 1, replacements: ["1", "2"] },
    ]);
    expect(result.text).toBe("Xcdef");
    expect(result.applied).toHaveLength(1);
  });
});

describe("mergeIssues", () => {
  const issue = (offset: number, length: number, replacements: string[], extra = {}) => ({
    offset,
    length,
    message: "m",
    category: "grammar" as const,
    replacements,
    source: "local" as const,
    rule_id: "R",
    severity: "error" as const,
    ...extra,
  });

  it("keeps the first issue on overlap, unless it is only a suggestion and the second a fix", () => {
    const suggestion = issue(12, 4, ["viens", "vient", "bien"]);
    const fix = issue(12, 4, ["viens"], { source: "languagetool" });
    expect(mergeIssues([suggestion], [fix])).toEqual([fix]);
    const held = issue(12, 4, ["viens"], { auto_fix: false });
    expect(mergeIssues([held], [fix])).toEqual([fix]);
    const firstFix = issue(12, 4, ["viens"]);
    expect(mergeIssues([firstFix], [issue(12, 4, ["vient"])])).toEqual([firstFix]);
    expect(mergeIssues([suggestion], [issue(12, 4, ["a", "b"])])).toEqual([suggestion]);
  });
});
