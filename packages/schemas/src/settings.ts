import { z } from "zod";
import { CorrectionModeSchema, LanguageCodeSchema, OperationSchema } from "./common.ts";

export const PROVIDER_KINDS = [
  "openai",
  "openai_compatible",
  "anthropic",
  "gemini",
  "ollama",
] as const;
export const ProviderKindSchema = z.enum(PROVIDER_KINDS);
export type ProviderKind = z.infer<typeof ProviderKindSchema>;

export const JsonModeSchema = z.enum(["json_schema", "json_object", "none"]);
export type JsonMode = z.infer<typeof JsonModeSchema>;

const idSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, "Use lowercase letters, digits, '-' or '_'");

/** Non-secret provider configuration. API keys live in the trusted executor only. */
export const ProviderConfigSchema = z.strictObject({
  id: idSchema,
  kind: ProviderKindSchema,
  label: z.string().min(1).max(80),
  /** Required for openai_compatible; defaults per kind otherwise. */
  base_url: z.url({ protocol: /^https?$/ }).optional(),
  model: z.string().min(1),
  enabled: z.boolean().default(true),
  /** Explicit user consent to send text to this provider (ignored for local providers). */
  consent_granted: z.boolean().default(false),
  temperature: z.number().min(0).max(2).optional(),
  max_output_tokens: z.number().int().positive().optional(),
  json_mode: JsonModeSchema.optional(),
  timeout_ms: z.number().int().positive().optional(),
  /**
   * Local models (Ollama): seconds the model stays in memory after a request. Defaults to 0 —
   * unload immediately — so Typely never holds gigabytes of RAM while idle.
   */
  keep_alive_seconds: z.number().int().min(0).max(86_400).optional(),
  /**
   * Let reasoning ("thinking") models think before answering. Off by default: on a laptop
   * CPU it turned a 2 s correction into a 200 s one (see docs/development/ollama-benchmark.md).
   */
  thinking: z.boolean().optional(),
  /** Prompt size. Defaults to "compact" for local endpoints and "full" for cloud ones. */
  prompt_profile: z.enum(["full", "compact"]).optional(),
});
export type ProviderConfig = z.output<typeof ProviderConfigSchema>;
export type ProviderConfigInput = z.input<typeof ProviderConfigSchema>;

export const LanguageToolConfigSchema = z.strictObject({
  enabled: z.boolean().default(false),
  /** e.g. http://localhost:8081 (self-hosted) or https://api.languagetool.org */
  base_url: z.url({ protocol: /^https?$/ }),
  consent_granted: z.boolean().default(false),
  /** Premium account user name; the API key itself is a secret held by the transport. */
  username: z.string().optional(),
});
export type LanguageToolConfig = z.output<typeof LanguageToolConfigSchema>;

export const PrivacySettingsSchema = z.strictObject({
  /** Master switch for any processing by non-local services. Off by default. */
  cloud_processing_allowed: z.boolean().default(false),
  store_history: z.boolean().default(false),
  blocked_sites: z.array(z.string()).default([]),
  allowed_sites: z.array(z.string()).default([]),
  disabled_apps: z.array(z.string()).default([]),
});
export type PrivacySettings = z.output<typeof PrivacySettingsSchema>;

export const LimitsSchema = z.strictObject({
  max_input_chars: z.number().int().positive().default(20_000),
  request_timeout_ms: z.number().int().positive().default(45_000),
  max_retries: z.number().int().min(0).max(5).default(1),
});
export type Limits = z.output<typeof LimitsSchema>;

export const EngineSettingsSchema = z
  .strictObject({
    default_mode: CorrectionModeSchema.default("hybrid"),
    preferred_language: z.union([LanguageCodeSchema, z.literal("auto")]).default("auto"),
    providers: z.array(ProviderConfigSchema).default([]),
    /** Provider ids in fallback order. Empty = order of `providers`. */
    provider_order: z.array(z.string()).default([]),
    /** Per-operation provider override (head of the chain for that operation). */
    operation_providers: z.partialRecord(OperationSchema, z.string()).default({}),
    languagetool: LanguageToolConfigSchema.optional(),
    /** Local rule ids the user turned off (e.g. "FR_NBSP_BEFORE_PUNCTUATION"). */
    disabled_rules: z.array(z.string()).default([]),
    privacy: PrivacySettingsSchema.default(PrivacySettingsSchema.parse({})),
    limits: LimitsSchema.default(LimitsSchema.parse({})),
  })
  .superRefine((s, ctx) => {
    const ids = new Set<string>();
    for (const p of s.providers) {
      if (ids.has(p.id)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate provider id '${p.id}'`,
          path: ["providers"],
        });
      }
      ids.add(p.id);
      if (p.kind === "openai_compatible" && p.base_url === undefined) {
        ctx.addIssue({
          code: "custom",
          message: `Provider '${p.id}' (openai_compatible) requires base_url`,
          path: ["providers"],
        });
      }
    }
    for (const id of [...s.provider_order, ...Object.values(s.operation_providers)]) {
      if (id !== undefined && !ids.has(id)) {
        ctx.addIssue({
          code: "custom",
          message: `Unknown provider id '${id}'`,
          path: ["provider_order"],
        });
      }
    }
  });
export type EngineSettings = z.output<typeof EngineSettingsSchema>;
export type EngineSettingsInput = z.input<typeof EngineSettingsSchema>;
