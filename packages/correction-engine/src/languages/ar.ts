import { type LocalRule, matchAll } from "../rules/types.ts";
import type { LanguageProfile } from "./types.ts";

const ARABIC_PUNCTUATION: Readonly<Record<string, string>> = { ",": "،", ";": "؛", "?": "؟" };

const latinPunctuation: LocalRule = {
  id: "AR_LATIN_PUNCTUATION",
  category: "punctuation",
  severity: "warning",
  find: ({ text }) =>
    matchAll(text, /(?<=\p{Script=Arabic}\p{M}*\s*)[,;?](?!\p{N})/gu, (m) => {
      const replacement = ARABIC_PUNCTUATION[m[0]];
      return replacement === undefined
        ? undefined
        : {
            offset: m.index,
            length: 1,
            message: `في النص العربي تُستخدم علامة «${replacement}» بدلاً من «${m[0]}».`,
            replacements: [replacement],
          };
    }),
};

const spaceBeforePunctuation: LocalRule = {
  id: "AR_SPACE_BEFORE_PUNCTUATION",
  category: "punctuation",
  severity: "warning",
  find: ({ text }) =>
    matchAll(text, /(?<=[\p{Script=Arabic}\p{M}]) +(?=[،؛؟!:])/gu, (m) => ({
      offset: m.index,
      length: m[0].length,
      message: "لا توضع مسافة قبل علامة الترقيم.",
      replacements: [""],
    })),
};

export const arabic: LanguageProfile = {
  code: "ar",
  name: "Arabic",
  nativeName: "العربية",
  direction: "rtl",
  script: "arabic",
  stopwords: new Set(
    `في من على إلى عن مع هذا هذه ذلك تلك التي الذي الذين هو هي هم نحن أنا أنت أن إن كان
     كانت لا ما لم لن قد كل بعد قبل عند حتى أو ثم لكن بين أي يا شكرا مرحبا السلام`
      .split(/\s+/)
      .filter(Boolean),
  ),
  legitimateRepeats: new Set(["لا", "جدا", "شكرا"]),
  abbreviations: new Set(),
  // Only unambiguous hamza omissions; ambiguous forms (ان، اي، اخر) are left to the AI layer.
  misspellings: new Map([
    ["الى", "إلى"],
    ["انا", "أنا"],
    ["انت", "أنت"],
    ["اذا", "إذا"],
    ["ايضا", "أيضا"],
    ["الان", "الآن"],
    ["لان", "لأن"],
    ["اين", "أين"],
    ["او", "أو"],
    ["اول", "أول"],
    ["اكثر", "أكثر"],
    ["اريد", "أريد"],
  ]),
  phrases: [
    {
      // Matches انشاء الله، إنشاء الله، ان شاء الله… (the already-correct form is a no-op).
      pattern: /(?<![\p{L}\p{M}])[اإأ]ن\s?شاء\s+الله(?![\p{L}\p{M}])/gu,
      replacements: ["إن شاء الله"],
      message: "تُكتب «إن شاء الله» منفصلة.",
      category: "spelling",
    },
  ],
  rules: [latinPunctuation, spaceBeforePunctuation],
  promptGuidance:
    "العربية: صحّح الهمزات (أ، إ، آ، ء)، والتاء المربوطة والهاء، والألف المقصورة والياء، والتنوين عند الحاجة، " +
    "وعلامات الترقيم العربية (، ؛ ؟). حافظ على مستوى اللغة (فصحى أو عامية) كما كتبه المؤلف ولا تحوّل العامية " +
    "إلى فصحى إلا عند طلب إعادة الصياغة الرسمية. لا تضف التشكيل إلا إذا كان موجوداً في النص. " +
    "Arabic is right-to-left; keep Latin-script names, acronyms and code exactly as written.",
};
