import { type LocalRule, matchAll } from "../rules/types.ts";

/**
 * "Se rendre compte": the participle never agrees, because "compte" is its direct object.
 * "Elle s'est rendue compte" → "rendu compte". Models make this mistake while "fixing" a
 * correct sentence.
 */
const RENDU_COMPTE =
  /(?<![\p{L}])(?:s['’]|se\s+|m['’]|me\s+|t['’]|te\s+|nous\s+|vous\s+)(?:est|sont|était|étaient|suis|es|sommes|êtes|serait|seraient|sera|seront|être|étais|étions|étiez)\s+(rendu(?:e|s|es))\s+compte(?![\p{L}])/giu;

export const renduCompte: LocalRule = {
  id: "FR_RENDU_COMPTE",
  category: "agreement",
  severity: "error",
  find: ({ text }) =>
    matchAll(text, RENDU_COMPTE, (m) => {
      const participle = m[1] ?? "";
      return {
        offset: m.index + m[0].lastIndexOf(participle, m[0].length - " compte".length),
        length: participle.length,
        message: "Dans « se rendre compte », le participe reste invariable : « rendu ».",
        replacements: ["rendu"],
      };
    }),
};
