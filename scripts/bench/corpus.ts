import type { CorrectionRequest } from "@typely/schemas";

/**
 * Benchmark corpus with deliberate errors. `expect` lists fragments a correct output must
 * contain; `forbid` lists the original errors that must be gone; `keep` lists terms that
 * must survive verbatim (technical words, URLs, numbers). Scoring is automatic, but the
 * outputs are also reviewed by hand — substring checks cannot judge fluency.
 */
export interface BenchCase {
  id: string;
  language: "fr" | "en" | "ar";
  request: CorrectionRequest;
  expect: string[];
  forbid: string[];
  keep: string[];
}

export const CORPUS: BenchCase[] = [
  {
    id: "fr-agreement",
    language: "fr",
    request: {
      operation: "fix",
      text: "Nous avons acheter des pommes hier, mais elles était trop mûre pour faire une tarte.",
    },
    expect: ["acheté", "étaient", "mûres"],
    forbid: ["avons acheter", "elles était", "trop mûre "],
    keep: ["pommes", "tarte"],
  },
  {
    id: "fr-tech-terms",
    language: "fr",
    request: {
      operation: "fix",
      text: "Est-ce que le build du pipeline est passer ? Le deploy de demain dépend de sa.",
    },
    expect: ["passé", "ça"],
    forbid: ["est passer", "dépend de sa"],
    keep: ["build", "pipeline", "deploy"],
  },
  {
    id: "fr-professional",
    language: "fr",
    request: {
      operation: "professional",
      text: "salut, tu peux m'envoyer le rapport vite stp, j'en ai besoin pour la réunion de 14h",
      context: { kind: "chat" },
    },
    expect: ["rapport", "réunion"],
    forbid: ["stp"],
    keep: ["14"],
  },
  {
    id: "en-homophones",
    language: "en",
    request: {
      operation: "fix",
      text: "Their going to send the report tomorow, but i dont think its ready yet.",
    },
    expect: ["They're", "tomorrow", "don't", "it's", " I "],
    forbid: ["Their going", "tomorow", "dont", " i "],
    keep: ["report"],
  },
  {
    id: "en-agreement-url",
    language: "en",
    request: {
      operation: "fix",
      text: "Each of the developers have pushed they're changes to https://git.example.com/repo before the 5pm deadline.",
    },
    expect: ["has pushed", "their changes"],
    forbid: ["have pushed", "they're changes"],
    keep: ["https://git.example.com/repo", "5pm"],
  },
  {
    id: "en-translate-fr",
    language: "en",
    request: {
      operation: "translate",
      text: "Please review the attached document before Friday's meeting.",
      target_language: "fr",
    },
    expect: ["vendredi", "document"],
    forbid: ["Please", "meeting"],
    keep: [],
  },
  {
    id: "ar-hamza-taa",
    language: "ar",
    request: { operation: "fix", text: "انا ذهبت الى المدرسه امس و كان الجو جميل جدا" },
    expect: ["أنا", "إلى", "المدرسة", "أمس"],
    forbid: ["المدرسه", " الى "],
    keep: ["ذهبت"],
  },
  {
    id: "ar-punctuation",
    language: "ar",
    request: { operation: "fix", text: "هل يمكنك ارسال التقرير قبل الاجتماع ,شكرا" },
    expect: ["إرسال", "،"],
    forbid: [" ,", "ارسال"],
    keep: ["التقرير", "الاجتماع"],
  },
  {
    id: "ar-professional",
    language: "ar",
    request: {
      operation: "professional",
      text: "ممكن تبعتلي الملف بسرعة عشان الاجتماع الساعة 3",
    },
    expect: ["الملف", "الاجتماع"],
    forbid: [],
    keep: ["3"],
  },
];
