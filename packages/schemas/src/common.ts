import { z } from "zod";

/** Writing operations offered by every Typely surface. */
export const OPERATIONS = [
  "fix",
  "rewrite",
  "professional",
  "concise",
  "friendly",
  "clarity",
  "translate",
  "prompt",
] as const;
export const OperationSchema = z.enum(OPERATIONS);
export type Operation = z.infer<typeof OperationSchema>;

/**
 * ISO 639-1/639-3 language code, optionally with an ISO 3166 region ("fr", "en-GB", "ary").
 * `und` means undetermined.
 */
export const LanguageCodeSchema = z
  .string()
  .regex(/^(?:[a-z]{2,3}(?:-[A-Z]{2})?|und)$/, "Expected a language code such as 'fr' or 'en-GB'");
export type LanguageCode = z.infer<typeof LanguageCodeSchema>;

/** local = deterministic layers only; ai = LLM only; hybrid = local findings + LLM. */
export const CORRECTION_MODES = ["local", "ai", "hybrid"] as const;
export const CorrectionModeSchema = z.enum(CORRECTION_MODES);
export type CorrectionMode = z.infer<typeof CorrectionModeSchema>;

export const ISSUE_CATEGORIES = [
  "spelling",
  "grammar",
  "punctuation",
  "capitalization",
  "agreement",
  "conjugation",
  "typography",
  "whitespace",
  "repetition",
  "style",
  "clarity",
  "tone",
  "concision",
  "translation",
  "structure",
  "other",
] as const;
export const IssueCategorySchema = z.enum(ISSUE_CATEGORIES);
export type IssueCategory = z.infer<typeof IssueCategorySchema>;

export const FINDING_SOURCES = ["local", "languagetool", "ai"] as const;
export const FindingSourceSchema = z.enum(FINDING_SOURCES);
export type FindingSource = z.infer<typeof FindingSourceSchema>;

/** Kind of writing context, used to tune tone-related operations. */
export const CONTEXT_KINDS = ["generic", "email", "chat", "document", "social", "prompt"] as const;
export const ContextKindSchema = z.enum(CONTEXT_KINDS);
export type ContextKind = z.infer<typeof ContextKindSchema>;
