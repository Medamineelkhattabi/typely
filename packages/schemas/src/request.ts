import { z } from "zod";
import {
  ContextKindSchema,
  CorrectionModeSchema,
  LanguageCodeSchema,
  OperationSchema,
} from "./common.ts";

export const RequestContextSchema = z.strictObject({
  kind: ContextKindSchema.default("generic"),
  /** Host application or site hint, e.g. "outlook", "chatgpt.com". Never page content. */
  app: z.string().max(100).optional(),
  /** For the `prompt` operation: the AI system the prompt is written for. */
  target_ai: z.string().max(60).optional(),
});
export type RequestContext = z.infer<typeof RequestContextSchema>;

export const CorrectionRequestSchema = z
  .strictObject({
    operation: OperationSchema,
    text: z.string().min(1, "Text is empty"),
    /** User override of automatic language detection. */
    language: LanguageCodeSchema.optional(),
    /** Required for `translate`. */
    target_language: LanguageCodeSchema.optional(),
    mode: CorrectionModeSchema.optional(),
    context: RequestContextSchema.optional(),
    /** Force a specific provider id instead of the configured order. */
    provider_id: z.string().optional(),
  })
  .refine((r) => r.operation !== "translate" || r.target_language !== undefined, {
    message: "target_language is required for translate",
    path: ["target_language"],
  })
  .refine((r) => r.text.trim().length > 0, { message: "Text is empty", path: ["text"] });
export type CorrectionRequest = z.input<typeof CorrectionRequestSchema>;
export type ParsedCorrectionRequest = z.output<typeof CorrectionRequestSchema>;
