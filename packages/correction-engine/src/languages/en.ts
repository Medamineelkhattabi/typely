import { type LocalRule, matchAll } from "../rules/types.ts";
import { quantifierPlural, thereIsPlural } from "./en-agreement.ts";
import type { LanguageProfile } from "./types.ts";

const lowercaseI: LocalRule = {
  id: "EN_LOWERCASE_I",
  category: "capitalization",
  severity: "error",
  find: ({ text }) =>
    // Standalone "i" (also in i'm, i've…), but not "i.e.", file paths or identifiers.
    matchAll(text, /(?<![\p{L}\p{N}_'’.\-/\\])i(?![\p{L}\p{N}_\-/\\]|\.\p{L})/gu, (m) => ({
      offset: m.index,
      length: 1,
      message: "The pronoun “I” is always capitalised.",
      replacements: ["I"],
    })),
};

const spaceBeforePunctuation: LocalRule = {
  id: "EN_SPACE_BEFORE_PUNCTUATION",
  category: "punctuation",
  severity: "warning",
  find: ({ text }) =>
    // Excludes emoticons such as " :)" or " ;-)".
    matchAll(text, /(?<=[\p{L}\p{N}]) +(?=[;:!?](?![)(DPpOo3/\\|*-]))/gu, (m) => ({
      offset: m.index,
      length: m[0].length,
      message: "In English, there is no space before this punctuation mark.",
      replacements: [""],
    })),
};

export const english: LanguageProfile = {
  code: "en",
  name: "English",
  nativeName: "English",
  direction: "ltr",
  script: "latin",
  stopwords: new Set(
    `the of and to in is it that was for with as be by this are from at or have not but they
     his her she he we you your our their them been has had were would could should will
     what which who when where why how there here than then these those its into about
     just also only very much more most some any all can does did do don't i'm it's
     i i've i'll i'd you're we're they're isn't aren't wasn't doesn't didn't won't can't
     my me him us an one other such after before because while please thanks thank hello
     hi regards dear need know think want like get got make made going well over out up`
      .split(/\s+/)
      .filter(Boolean),
  ),
  apostropheForm: "contraction-suffix",
  legitimateRepeats: new Set(["that", "had", "is", "bye", "very", "so", "no", "ha", "la"]),
  abbreviations: new Set(
    `e.g i.e etc mr mrs ms dr prof vs inc ltd jr sr st no fig approx dept est min max
     jan feb mar apr jun jul aug sep sept oct nov dec mon tue wed thu fri sat sun a.m p.m`
      .split(/\s+/)
      .filter(Boolean),
  ),
  misspellings: new Map([
    ["teh", "the"],
    ["recieve", "receive"],
    ["recieved", "received"],
    ["definately", "definitely"],
    ["seperate", "separate"],
    ["seperately", "separately"],
    ["occured", "occurred"],
    ["occurence", "occurrence"],
    ["untill", "until"],
    ["wich", "which"],
    ["alot", "a lot"],
    ["accomodate", "accommodate"],
    ["acheive", "achieve"],
    ["adress", "address"],
    ["begining", "beginning"],
    ["beleive", "believe"],
    ["calender", "calendar"],
    ["comittee", "committee"],
    ["enviroment", "environment"],
    ["existance", "existence"],
    ["goverment", "government"],
    ["immediatly", "immediately"],
    ["independant", "independent"],
    ["neccessary", "necessary"],
    ["necesary", "necessary"],
    ["noticable", "noticeable"],
    ["publically", "publicly"],
    ["recomend", "recommend"],
    ["refered", "referred"],
    ["succesful", "successful"],
    ["tommorow", "tomorrow"],
    ["tomorow", "tomorrow"],
    ["truely", "truly"],
    ["wierd", "weird"],
    ["thier", "their"],
    ["becuase", "because"],
    ["shoudl", "should"],
    ["woudl", "would"],
  ]),
  phrases: [
    {
      pattern: /(?<![\p{L}])(could|would|should|must|might) of(?![\p{L}])/giu,
      replacements: ["$1 have"],
      message: "Use “have”, not “of”, after a modal verb.",
      category: "grammar",
    },
  ],
  rules: [lowercaseI, spaceBeforePunctuation, quantifierPlural, thereIsPlural],
  promptGuidance:
    "English: keep the writer's variant (US or UK spelling) consistent with the input; do not switch variants. " +
    "Fix articles, subject–verb agreement, tense consistency and common confusions (its/it's, their/there/they're, " +
    "then/than, affect/effect).",
};
