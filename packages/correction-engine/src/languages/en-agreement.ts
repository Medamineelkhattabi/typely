import { type LocalRule, matchAll, matchCase } from "../rules/types.ts";

/**
 * English number agreement after quantifiers: "a lot of issue" → "a lot of issues", "There is
 * a lot of issues" → "There are…". High precision first (ADR-014): only nouns right before the
 * end of a clause are touched, and quantifiers that also take uncountable nouns ("a lot of
 * information") only pluralise common countable nouns.
 */

/**
 * Quantifiers that always need a plural noun. Not "both" (usually before a verb: "both
 * hold") and not digits (versions and labels: "0.40.7 portable", "Phase 2 desktop").
 */
const PLURAL_ONLY =
  "many|several|few|a few|numerous|various|multiple|these|those|a couple of|a number of|" +
  "dozens of|hundreds of|thousands of|millions of|two|three|four|five|six|seven|eight|nine|ten|" +
  "eleven|twelve|twenty|fifty|hundred";
/** Quantifiers that also take uncountable nouns: only countable nouns from COUNTABLE. */
const MIXED = "a lot of|lots of|plenty of";

/** Common countable nouns, for "a lot of …" (where "a lot of information" is correct). */
const COUNTABLE = new Set(
  `issue problem error bug mistake question answer idea task file folder document report email
   message comment request feature item thing option example case reason step point
   detail result test project meeting call user customer client friend person colleague
   employee member student teacher word sentence page line book article picture image video
   car day week month year hour minute second place country city house room table chair
   window door phone computer app tool button link product order ticket account update
   version release task review note list photo song game movie show event job role team`
    .split(/\s+/)
    .filter((w) => w !== ""),
);

/** Never pluralised, even after "many": uncountable or not a noun. */
const EXCLUDED = new Set(
  `information advice news knowledge research evidence equipment furniture luggage baggage
   software hardware data feedback progress homework work time money fun help stuff traffic
   music weather water food rice bread milk coffee tea sugar salt patience courage luck love
   interest pressure support attention effort experience potential value demand content
   people men women children police staff cattle sheep fish deer series species aircraft
   good bad new old other more most much such same own first last next few many several
   them us you it this that these those which what who whom whose all some any each every
   one none both either neither half lot plenty number couple dozen hundred thousand million`
    .split(/\s+/)
    .filter((w) => w !== ""),
);

const IRREGULAR: Readonly<Record<string, string>> = {
  man: "men",
  woman: "women",
  child: "children",
  person: "people",
  foot: "feet",
  tooth: "teeth",
  mouse: "mice",
};

/** The plural of a regular noun, or undefined when it cannot be formed safely. */
export function pluralise(noun: string): string | undefined {
  const irregular = IRREGULAR[noun];
  if (irregular !== undefined) return irregular;
  // Already plural-looking, or endings with irregular plurals (photo/potato, knife/roof).
  if (/(?:s|o|f|fe)$/.test(noun)) return undefined;
  if (/[^aeiou]y$/.test(noun)) return `${noun.slice(0, -1)}ies`;
  if (/(?:ch|sh|x|z)$/.test(noun)) return `${noun}es`;
  return `${noun}s`;
}

/** What may follow the noun: the end of a clause, a conjunction or a time word. */
const END = String.raw`(?=\s*(?:[.,!?;:)\]]|$)|\s+(?:and|or|but|that|which|who|today|tomorrow|yesterday|now|here|there|left|ago)\b)`;

const SINGULAR_AFTER_QUANTIFIER = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?:(${PLURAL_ONLY})|(${MIXED}))\s+([a-z]+)${END}`,
  "giu",
);

export const quantifierPlural: LocalRule = {
  id: "EN_QUANTIFIER_PLURAL",
  category: "agreement",
  severity: "error",
  find: ({ text }) =>
    matchAll(text, SINGULAR_AFTER_QUANTIFIER, (m) => {
      const plainQuantifier = m[1];
      const noun = m[3] ?? "";
      const lower = noun.toLowerCase();
      if (noun !== lower || EXCLUDED.has(lower)) return undefined;
      const known = COUNTABLE.has(lower);
      if (plainQuantifier === undefined && !known) return undefined;
      // Likely a verb, adjective or abbreviation ("both working", "8 min") unless known.
      if (!known && (lower.length < 4 || /(?:ed|ing)$/.test(lower))) return undefined;
      const plural = pluralise(lower);
      if (plural === undefined) return undefined;
      return {
        offset: m.index + m[0].length - noun.length,
        length: noun.length,
        message: `After “${(m[1] ?? m[2] ?? "").toLowerCase()}”, the noun is plural: “${plural}”.`,
        replacements: [plural],
      };
    }),
};

/** "is"/"was" before a quantified plural noun. "news", "series" and similar are excluded. */
const THERE_IS_PLURAL = new RegExp(
  String.raw`(?<![\p{L}])(there)(\s+is|\s+was|['’]s)\s+(?:${PLURAL_ONLY}|${MIXED})\s+([a-z]+s)(?![\p{L}])`,
  "giu",
);
const NOT_PLURAL = /(?:ss|us|is|ics)$/;

export const thereIsPlural: LocalRule = {
  id: "EN_THERE_IS_PLURAL",
  category: "agreement",
  severity: "error",
  find: ({ text }) =>
    matchAll(text, THERE_IS_PLURAL, (m) => {
      const there = m[1] ?? "";
      const verb = m[2] ?? "";
      const noun = (m[3] ?? "").toLowerCase();
      if (NOT_PLURAL.test(noun) || EXCLUDED.has(noun) || noun.length < 4) return undefined;
      const past = /was/i.test(verb);
      const replacement = `${there} ${matchCase(verb.trim().replace(/^['’]/, ""), past ? "were" : "are")}`;
      return {
        offset: m.index,
        length: there.length + verb.length,
        message: `With a plural noun, use “there ${past ? "were" : "are"}”.`,
        replacements: [replacement],
      };
    }),
};
