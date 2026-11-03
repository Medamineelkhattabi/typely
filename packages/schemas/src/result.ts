import { z } from "zod";
import {
  CorrectionModeSchema,
  FindingSourceSchema,
  IssueCategorySchema,
  LanguageCodeSchema,
  OperationSchema,
} from "./common.ts";

export const ExplanationItemSchema = z.strictObject({
  original: z.string(),
  corrected: z.string(),
  reason: z.string(),
  category: IssueCategorySchema,
  source: FindingSourceSchema,
});
export type ExplanationItem = z.infer<typeof ExplanationItemSchema>;

export const WARNING_CODES = [
  "language_changed",
  "protected_token_lost",
  "excessive_changes",
  "provider_fallback",
  "repaired_response",
  "mixed_language",
  "low_confidence",
  "languagetool_unavailable",
  "model_warning",
  "no_changes",
  "ai_rejected",
] as const;
export const WarningCodeSchema = z.enum(WARNING_CODES);
export type WarningCode = z.infer<typeof WarningCodeSchema>;

export const ResultWarningSchema = z.strictObject({
  code: WarningCodeSchema,
  message: z.string(),
});
export type ResultWarning = z.infer<typeof ResultWarningSchema>;

export const DiffSegmentSchema = z.strictObject({
  type: z.enum(["equal", "insert", "delete"]),
  text: z.string(),
});
export type DiffSegment = z.infer<typeof DiffSegmentSchema>;

export const UsageSchema = z.strictObject({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
});
export type Usage = z.infer<typeof UsageSchema>;

export const AttemptSchema = z.strictObject({
  provider_id: z.string(),
  outcome: z.enum(["success", "error"]),
  error_kind: z.string().optional(),
  duration_ms: z.number().nonnegative(),
});
export type Attempt = z.infer<typeof AttemptSchema>;

export const ResultMetaSchema = z.strictObject({
  mode: CorrectionModeSchema,
  layers: z.array(FindingSourceSchema),
  provider_id: z.string().optional(),
  model: z.string().optional(),
  usage: UsageSchema.optional(),
  attempts: z.array(AttemptSchema),
  duration_ms: z.number().nonnegative(),
  prompt_version: z.string().optional(),
});
export type ResultMeta = z.infer<typeof ResultMetaSchema>;

export const CorrectionResultSchema = z.strictObject({
  operation: OperationSchema,
  detected_language: LanguageCodeSchema,
  language_confidence: z.number().min(0).max(1),
  corrected_text: z.string(),
  explanation: z.array(ExplanationItemSchema),
  confidence: z.number().min(0).max(1),
  warnings: z.array(ResultWarningSchema),
  changes: z.array(DiffSegmentSchema),
  meta: ResultMetaSchema,
});
export type CorrectionResult = z.infer<typeof CorrectionResultSchema>;

/** A located issue for inline indicators. Offsets are UTF-16 code units (DOM semantics). */
export const GrammarIssueSchema = z.strictObject({
  offset: z.number().int().nonnegative(),
  length: z.number().int().nonnegative(),
  message: z.string(),
  category: IssueCategorySchema,
  replacements: z.array(z.string()),
  source: z.enum(["local", "languagetool"]),
  rule_id: z.string(),
  severity: z.enum(["error", "warning", "suggestion"]),
  /**
   * false: shown as a suggestion, never applied automatically even with a single replacement
   * (e.g. LanguageTool style hints, or two fixes that conflict). Absent: applied when it has
   * exactly one replacement.
   */
  auto_fix: z.boolean().optional(),
});
export type GrammarIssue = z.infer<typeof GrammarIssueSchema>;

export const CheckResultSchema = z.strictObject({
  detected_language: LanguageCodeSchema,
  language_confidence: z.number().min(0).max(1),
  issues: z.array(GrammarIssueSchema),
  warnings: z.array(ResultWarningSchema),
});
export type CheckResult = z.infer<typeof CheckResultSchema>;
