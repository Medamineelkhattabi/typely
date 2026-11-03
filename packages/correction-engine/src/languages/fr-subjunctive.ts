import { type LocalRule, matchAll, matchCase } from "../rules/types.ts";

/**
 * Subjunctive after expressions that always require it: "Il faut que tu viens" → "viennes".
 * LanguageTool only fixes the person ("vien" → "viens"), and small models keep the
 * indicative. High precision: only unambiguous triggers, only the subject right after "que",
 * and only irregular verbs whose indicative and subjunctive differ (for -er verbs "tu
 * manges" is both).
 */

/** Expressions followed by the subjunctive, never the indicative. */
const TRIGGERS = [
  "il faut",
  "faut",
  "il faudrait",
  "il faudra",
  "il fallait",
  "pour",
  "afin",
  "avant",
  "bien",
  "quoi",
  "sans",
  "à condition",
  "jusqu'à ce",
  "jusqu’à ce",
  "je veux",
  "je voudrais",
  "j'aimerais",
  "j’aimerais",
  "il est important",
  "il est nécessaire",
  "il est possible",
  "il se peut",
];

/** Indicative (and common misspelt) forms → subjunctive, for "tu" and "il/elle/on". */
const SECOND: Readonly<Record<string, string>> = {
  viens: "viennes",
  vien: "viennes",
  fais: "fasses",
  vas: "ailles",
  es: "sois",
  as: "aies",
  peux: "puisses",
  sais: "saches",
  veux: "veuilles",
  prends: "prennes",
  dis: "dises",
  vois: "voies",
  dois: "doives",
  mets: "mettes",
  pars: "partes",
  sors: "sortes",
  écris: "écrives",
  lis: "lises",
  connais: "connaisses",
  reçois: "reçoives",
  bois: "boives",
  tiens: "tiennes",
};
const THIRD: Readonly<Record<string, string>> = {
  vient: "vienne",
  fait: "fasse",
  va: "aille",
  est: "soit",
  a: "ait",
  peut: "puisse",
  sait: "sache",
  veut: "veuille",
  prend: "prenne",
  dit: "dise",
  voit: "voie",
  doit: "doive",
  met: "mette",
  part: "parte",
  sort: "sorte",
  écrit: "écrive",
  lit: "lise",
  connaît: "connaisse",
  connait: "connaisse",
  reçoit: "reçoive",
  boit: "boive",
  tient: "tienne",
};

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PATTERN = new RegExp(
  String.raw`(?<![\p{L}])(?:${TRIGGERS.map(escapeRegex).join("|")})\s+(?:que\s+(tu|il|elle|on)|qu['’](il|elle|on))\s+([\p{L}]+)(?![\p{L}'’-])`,
  "giu",
);

export const frenchSubjunctive: LocalRule = {
  id: "FR_SUBJONCTIF",
  category: "grammar",
  severity: "error",
  find: ({ text }) =>
    matchAll(text, PATTERN, (m) => {
      const subject = (m[1] ?? m[2] ?? "").toLowerCase();
      const verb = m[3] ?? "";
      const table = subject === "tu" ? SECOND : THIRD;
      const subjunctive = table[verb.toLowerCase()];
      if (subjunctive === undefined) return undefined;
      return {
        offset: m.index + m[0].length - verb.length,
        length: verb.length,
        message: `Après « ${m[0].slice(0, m[0].length - verb.length).trim()} », le verbe se met au subjonctif : « ${subjunctive} ».`,
        replacements: [matchCase(verb, subjunctive)],
      };
    }),
};
