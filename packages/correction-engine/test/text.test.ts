import { describe, expect, it } from "vitest";
import {
  changeRatio,
  diffWords,
  findProtectedSpans,
  keepApostrophes,
  keepRegister,
  keepSpacing,
  tokenize,
} from "../src/index.ts";

const apply = (segments: ReturnType<typeof diffWords>, side: "original" | "revised") =>
  segments
    .filter((s) => s.type === "equal" || s.type === (side === "original" ? "delete" : "insert"))
    .map((s) => s.text)
    .join("");

describe("diffWords", () => {
  it("produces word-level changes", () => {
    expect(diffWords("Je suis allé au marché", "Je suis allée au marché hier")).toEqual([
      { type: "equal", text: "Je suis " },
      { type: "delete", text: "allé" },
      { type: "insert", text: "allée" },
      { type: "equal", text: " au marché" },
      { type: "insert", text: " hier" },
    ]);
  });

  it("handles identical, empty and fully different texts", () => {
    expect(diffWords("same", "same")).toEqual([{ type: "equal", text: "same" }]);
    expect(diffWords("", "")).toEqual([]);
    expect(diffWords("", "new")).toEqual([{ type: "insert", text: "new" }]);
    expect(diffWords("old", "")).toEqual([{ type: "delete", text: "old" }]);
  });

  it("reconstructs both sides exactly (Arabic, emoji, newlines)", () => {
    const cases: Array<[string, string]> = [
      ["انشاء الله سأرسل الملف الى الفريق", "إن شاء الله سأرسل الملف إلى الفريق"],
      ["Hello 👋 team,\nsee you soon", "Hello 👋 everyone,\n\nsee you very soon!"],
      ["a b c d e f g", "g f e d c b a"],
    ];
    for (const [original, revised] of cases) {
      const segments = diffWords(original, revised);
      expect(apply(segments, "original")).toBe(original);
      expect(apply(segments, "revised")).toBe(revised);
    }
  });

  it("stays fast on long texts", () => {
    const original = Array.from({ length: 3000 }, (_, i) => `word${i % 50}`).join(" ");
    const revised = original.replace(/word7\b/g, "WORD");
    const started = performance.now();
    const segments = diffWords(original, revised);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(apply(segments, "revised")).toBe(revised);
  });

  it("computes a change ratio", () => {
    expect(changeRatio("abcd", diffWords("abcd", "abcd"))).toBe(0);
    expect(changeRatio("one two", diffWords("one two", "three four"))).toBe(1);
  });

  it("tokenizes Arabic words as units", () => {
    expect(tokenize("مرحبا بكم")).toEqual(["مرحبا", " ", "بكم"]);
  });
});

describe("findProtectedSpans", () => {
  it("finds code, URLs, e-mails, mentions, hashtags, placeholders and file names", () => {
    const text =
      "See https://ex.com/a?b=1, mail a.b@ex.co, ping @jean.dupont #release, {{name}}, `npm test`, config.json\n```\nx\n```";
    const kinds = findProtectedSpans(text).map((s) => [s.kind, s.text]);
    expect(kinds).toEqual([
      ["url", "https://ex.com/a?b=1"],
      ["email", "a.b@ex.co"],
      ["mention", "@jean.dupont"],
      ["hashtag", "#release"],
      ["placeholder", "{{name}}"],
      ["inline_code", "`npm test`"],
      ["domain", "config.json"],
      ["code_block", "```\nx\n```"],
    ]);
  });

  it("does not treat sentence punctuation as part of a URL", () => {
    expect(findProtectedSpans("Go to www.example.com.")[0]?.text).toBe("www.example.com");
  });
});

describe("keepApostrophes / keepRegister", () => {
  it("keeps the writer's apostrophe style", () => {
    expect(keepApostrophes("I'll reply tonight.", "I’ll reply tonight.")).toBe(
      "I'll reply tonight.",
    );
    expect(keepApostrophes("J’ai faim.", "J'ai faim, qu'il dit.")).toBe("J’ai faim, qu’il dit.");
    expect(keepApostrophes("No apostrophe", "Model’s text")).toBe("Model's text");
  });

  it("puts back a switch between tu and vous, and only that", () => {
    expect(
      keepRegister(
        "Est-ce que tu as reçu le fichier PDF ?",
        "Est-ce que vous avez reçu le fichier PDF ?",
      ),
    ).toBe("Est-ce que tu as reçu le fichier PDF ?");
    expect(
      keepRegister(
        "Je te retrouve à la gare demain à 9 h.",
        "Je vous retrouve à la gare demain à 9h.",
      ),
    ).toBe("Je te retrouve à la gare demain à 9h.");
    expect(keepRegister("Tu vien demain ?", "Tu viens demain ?")).toBe("Tu viens demain ?");
  });

  it("puts back changes that only move spaces", () => {
    expect(keepSpacing("Rendez-vous à 9 h demain.", "Rendez-vous à 9h demain.")).toBe(
      "Rendez-vous à 9 h demain.",
    );
    expect(keepSpacing("Il vien à 9 h.", "Il vient à 9h.")).toBe("Il vient à 9 h.");
  });
});
