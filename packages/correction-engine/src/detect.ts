import type { LanguageRegistry } from "./languages/registry.ts";
import type { LanguageProfile } from "./languages/types.ts";
import { findProtectedSpans, maskProtected } from "./text/protected.ts";

export interface LanguageDetection {
  /** Language code, or "und" when undetermined. */
  language: string;
  /** 0–1. */
  confidence: number;
  /** True when a second language has a significant share of the text. */
  mixed: boolean;
  secondary?: string;
  scores: Record<string, number>;
}

const WORD = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu;
const ELISION = /^(?:qu|jusqu|lorsqu|puisqu|[ldjmtsnc])['’](.+)$/iu;
const CONTRACTION = /^(.+)['’](?:t|s|re|ve|ll|d|m)$/iu;
const ARABIC_LETTER = /[\p{Script=Arabic}]/u;
const LATIN_LETTER = /[\p{Script=Latin}]/u;
/**
 * Letters and marks used by common Latin-script languages that have no profile yet
 * (Spanish, Portuguese, German, Nordic, Slavic, Turkish…). They are evidence *against*
 * the registered profiles, so "¿Cómo estás?" is not reported as French.
 */
const FOREIGN_LATIN = /[áíóúñãõäößåøłńśźżčřšžěůőűğşı¿¡]/giu;

/**
 * Deterministic detection tuned for short texts (ADR-006): script analysis first, then
 * stop-word, diacritic and apostrophe-form scoring across the registered Latin-script
 * profiles. French text sprinkled with English technical terms stays French because
 * the scoring counts function words, not vocabulary.
 */
export function detectLanguage(text: string, registry: LanguageRegistry): LanguageDetection {
  const analysed = maskProtected(text, findProtectedSpans(text));
  let arabicLetters = 0;
  let latinLetters = 0;
  for (const char of analysed) {
    if (ARABIC_LETTER.test(char)) arabicLetters++;
    else if (LATIN_LETTER.test(char)) latinLetters++;
  }
  const letters = arabicLetters + latinLetters;
  if (letters === 0) return { language: "und", confidence: 0, mixed: false, scores: {} };

  const latin = scoreLatin(
    analysed,
    registry.all().filter((p) => p.script === "latin"),
  );
  const arabicShare = arabicLetters / letters;
  const hasArabicProfile = registry.get("ar") !== undefined;

  if (hasArabicProfile && arabicShare >= 0.5) {
    const secondary = latin.best;
    const mixed = arabicShare < 0.85 && secondary !== undefined;
    return {
      language: "ar",
      confidence: round(Math.min(1, 0.5 + arabicShare / 2)),
      mixed,
      ...(mixed && secondary !== undefined ? { secondary } : {}),
      scores: { ...latin.scores, ar: round(arabicShare) },
    };
  }

  if (latin.best === undefined) {
    return { language: "und", confidence: 0, mixed: false, scores: latin.scores };
  }
  const bestScore = latin.scores[latin.best] ?? 0;
  const secondScore = latin.second === undefined ? 0 : (latin.scores[latin.second] ?? 0);
  const dominance = bestScore / (bestScore + secondScore);
  // Short texts get lower confidence even when unambiguous.
  const evidence = 0.5 + 0.5 * Math.min(1, bestScore / 3);
  let confidence = dominance * evidence;
  // Very few function words in a long text suggests an unprofiled language.
  if (latin.words >= 8 && bestScore / latin.words < 0.12) confidence *= 0.5;

  // Strong evidence of an unprofiled language: report it as undetermined rather than guess.
  const foreign = analysed.match(FOREIGN_LATIN)?.length ?? 0;
  if (foreign >= 2 && foreign >= bestScore * 0.4) {
    return { language: "und", confidence: 0, mixed: false, scores: latin.scores };
  }

  const arabicMixed = hasArabicProfile && arabicShare >= 0.15;
  const latinMixed =
    latin.second !== undefined && secondScore >= 2 && secondScore >= bestScore * 0.3;
  const secondary = arabicMixed ? "ar" : latinMixed ? latin.second : undefined;
  return {
    language: latin.best,
    confidence: round(confidence * (1 - arabicShare)),
    mixed: secondary !== undefined,
    ...(secondary === undefined ? {} : { secondary }),
    scores: latin.scores,
  };
}

interface LatinScores {
  scores: Record<string, number>;
  best: string | undefined;
  second: string | undefined;
  words: number;
}

function scoreLatin(text: string, profiles: readonly LanguageProfile[]): LatinScores {
  const scores: Record<string, number> = Object.fromEntries(profiles.map((p) => [p.code, 0]));
  let words = 0;
  for (const match of text.matchAll(WORD)) {
    const token = match[0].toLowerCase();
    if (!LATIN_LETTER.test(token)) continue;
    words++;
    for (const profile of profiles) {
      let word = token;
      let hit = 0;
      if (profile.apostropheForm === "elision-prefix") {
        const elided = ELISION.exec(token);
        if (elided?.[1] !== undefined) {
          hit += 1;
          word = elided[1];
        }
      } else if (profile.apostropheForm === "contraction-suffix" && CONTRACTION.test(token)) {
        hit += 1;
      }
      if (profile.stopwords.has(word) || profile.stopwords.has(token)) hit += 1;
      else if (profile.markerChars?.test(word)) hit += 0.5;
      scores[profile.code] = (scores[profile.code] ?? 0) + hit;
    }
  }
  const ranked = Object.entries(scores)
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1]);
  return { scores, best: ranked[0]?.[0], second: ranked[1]?.[0], words };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
