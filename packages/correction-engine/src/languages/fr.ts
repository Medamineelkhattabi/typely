import { type LocalRule, matchAll } from "../rules/types.ts";
import type { LanguageProfile } from "./types.ts";

/** U+202F narrow no-break space (before ; ! ? and inside guillemets). */
export const NNBSP = " ";
/** U+00A0 no-break space (before :). */
export const NBSP = " ";

const spaceBeforeDoublePunctuation: LocalRule = {
  id: "FR_NBSP_BEFORE_PUNCTUATION",
  category: "typography",
  severity: "suggestion",
  find: ({ text }) =>
    // Only when glued to a word and followed by a space/end, so "10:30", "std::vector" and
    // "clé:valeur" are left alone.
    matchAll(text, /(?<=[\p{L}\p{N}»)\]])([;:!?])(?=\s|$|[»"')\]])/gu, (m) => {
      const punctuation = m[1] ?? "";
      return {
        offset: m.index,
        length: 1,
        message: `En français, « ${punctuation} » est précédé d’une espace insécable.`,
        replacements: [`${punctuation === ":" ? NBSP : NNBSP}${punctuation}`],
      };
    }),
};

const guillemetSpacing: LocalRule = {
  id: "FR_GUILLEMETS_SPACING",
  category: "typography",
  severity: "suggestion",
  find: ({ text }) => [
    ...matchAll(text, /«(?=[^\s  ])/gu, (m) => ({
      offset: m.index,
      length: 1,
      message: "Espace insécable après le guillemet ouvrant.",
      replacements: [`«${NNBSP}`],
    })),
    ...matchAll(text, /(?<=[^\s  ])»/gu, (m) => ({
      offset: m.index,
      length: 1,
      message: "Espace insécable avant le guillemet fermant.",
      replacements: [`${NNBSP}»`],
    })),
  ],
};

export const french: LanguageProfile = {
  code: "fr",
  name: "French",
  nativeName: "Français",
  direction: "ltr",
  script: "latin",
  // Words shared with English ("a", "on", "son", "plus", "me", "as") are deliberately excluded.
  stopwords: new Set(
    `le la les un une des du et est sont que qui quoi dans pour pas sur au aux ce cette ces
     cet il elle ils elles nous vous je tu ne se sa ses leur leurs mais ou où donc car avec
     par tout tous toute toutes très bien être avoir fait faire été suis es était ont mon ma
     mes ton ta tes notre votre nos vos comme si aussi encore déjà merci bonjour bonsoir salut
     oui non peut peux veux dois doit ça cela ceci quand lui moi toi là alors après avant chez
     sans sous entre même autre autres chaque fois rien personne quelque quelques aujourd'hui
     demain hier vais va allons allez cordialement svp parce comment pourquoi depuis pendant
     voici voilà ensuite enfin aussi beaucoup peu trop moins été avez avons serait sera`
      .split(/\s+/)
      .filter(Boolean),
  ),
  markerChars: /[éèêëàâîïôûùüÿçœæ]/iu,
  apostropheForm: "elision-prefix",
  legitimateRepeats: new Set(["nous", "vous", "très", "si", "là", "bien", "non", "oui"]),
  abbreviations: new Set(
    `m mme mlle mm dr pr etc cf ex p pp env av apr j.-c st ste vol chap fig tél tel min max
     no n° éd réf janv févr avr juil sept oct nov déc`
      .split(/\s+/)
      .filter(Boolean),
  ),
  misspellings: new Map([
    ["parmis", "parmi"],
    ["malgrés", "malgré"],
    ["apeller", "appeler"],
    ["developpement", "développement"],
    ["dévelopement", "développement"],
    ["notament", "notamment"],
    ["aparemment", "apparemment"],
    ["apparament", "apparemment"],
    ["courrir", "courir"],
    ["quelquechose", "quelque chose"],
    ["acceuil", "accueil"],
    ["acceuillir", "accueillir"],
    ["recu", "reçu"],
    ["recue", "reçue"],
    ["deja", "déjà"],
    ["voila", "voilà"],
    ["tres", "très"],
    ["etre", "être"],
    ["bientot", "bientôt"],
    ["aujourdhui", "aujourd'hui"],
    ["evidemment", "évidemment"],
    ["probleme", "problème"],
    ["problemes", "problèmes"],
    ["systeme", "système"],
    ["interessant", "intéressant"],
    ["interessante", "intéressante"],
    ["biensur", "bien sûr"],
    ["biensûr", "bien sûr"],
    ["mercie", "merci"],
    ["rapel", "rappel"],
    ["addresse", "adresse"],
  ]),
  phrases: [
    {
      pattern: /(?<![\p{L}])en faite(?![\p{L}])/giu,
      replacements: ["en fait"],
      message: "On écrit « en fait ».",
      category: "spelling",
    },
    {
      pattern: /(?<![\p{L}])(ca|sa) va(?![\p{L}])/giu,
      replacements: ["ça va"],
      message: "On écrit « ça va » (pronom démonstratif).",
      category: "spelling",
    },
    {
      pattern: /(?<![\p{L}])si (ils?)(?![\p{L}])/giu,
      replacements: ["s'$1"],
      message: "Élision obligatoire : « s’il », « s’ils ».",
      category: "grammar",
    },
    {
      pattern: /(?<![\p{L}])c'est à dire(?![\p{L}])/giu,
      replacements: ["c'est-à-dire"],
      message: "« c’est-à-dire » s’écrit avec des traits d’union.",
      category: "spelling",
    },
    {
      pattern: /(?<![\p{L}])quelque soit(?![\p{L}])/giu,
      replacements: ["quel que soit", "quelle que soit"],
      message: "« quel que soit » s’accorde avec le nom qui suit.",
      category: "grammar",
    },
  ],
  rules: [spaceBeforeDoublePunctuation, guillemetSpacing],
  promptGuidance:
    "Français : vérifier rigoureusement les accords (genre, nombre, participe passé avec être/avoir), " +
    "les conjugaisons, les homophones (a/à, ou/où, ces/ses, et/est, son/sont, -er/-é), les accents et la " +
    "ponctuation française (espace insécable avant ; : ! ?). Conserver tels quels les termes techniques " +
    "anglais d'usage courant (deploy, build, pipeline, meeting…) : ne pas les traduire. Respecter le " +
    "vouvoiement ou le tutoiement choisi par l'auteur.",
};
