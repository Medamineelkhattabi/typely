import { createAdapter } from "@typely/provider-adapters";
import {
  EngineSettingsSchema,
  LanguageCodeSchema,
  type Operation,
  OperationSchema,
  type ProviderConfig,
} from "@typely/schemas";
import { z } from "zod";

/** Mirrored by `DEFAULT_SHORTCUT` in `src-tauri/src/settings.rs`. */
export const DEFAULT_SHORTCUT = "Ctrl+Shift+Space";

/** Desktop-only settings. Rust mirrors this shape (`DesktopSettings`) and validates it again. */
export const DesktopSettingsSchema = z.strictObject({
  /** Global shortcut that captures the selection, e.g. "Ctrl+Shift+Space". */
  shortcut: z.string().trim().min(1).max(64).default(DEFAULT_SHORTCUT),
  /** Operation run as soon as the panel opens. */
  default_operation: OperationSchema.default("fix"),
  /** Target language of the panel's Translate action. */
  translate_target: LanguageCodeSchema.refine((c) => c !== "und", "Pick a language").default("en"),
});
export type DesktopSettings = z.output<typeof DesktopSettingsSchema>;

/** The settings file the Rust side persists (`%APPDATA%\app.typely.desktop\settings.json`). */
export const AppSettingsSchema = z.strictObject({
  version: z.literal(1).default(1),
  engine: EngineSettingsSchema.default(EngineSettingsSchema.parse({})),
  desktop: DesktopSettingsSchema.default(DesktopSettingsSchema.parse({})),
});
export type AppSettings = z.output<typeof AppSettingsSchema>;
export type AppSettingsInput = z.input<typeof AppSettingsSchema>;

export function defaultSettings(): AppSettings {
  return AppSettingsSchema.parse({});
}

/** Whether a provider sends text off the machine (not Ollama on loopback, not a loopback URL). */
export function isCloudProvider(provider: ProviderConfig): boolean {
  return !createAdapter(provider).isLocal;
}

/** Shown next to actions that local mode cannot run. */
export const NEEDS_AI_HINT = "Needs an AI model: set up Local AI or add a provider";

/** The operation to run: local mode only corrects, so any other choice falls back to `fix`. */
export function runnableOperation(operation: Operation, localOnly: boolean): Operation {
  return localOnly ? "fix" : operation;
}

/** Providers the engine will actually use: enabled and, for cloud ones, allowed by both switches. */
export function usableProviders(settings: AppSettings): ProviderConfig[] {
  const { providers, privacy } = settings.engine;
  return providers.filter(
    (p) =>
      p.enabled && (!isCloudProvider(p) || (privacy.cloud_processing_allowed && p.consent_granted)),
  );
}
