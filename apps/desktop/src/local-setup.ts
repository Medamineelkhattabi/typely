import type { EngineSettings, Operation, ProviderConfig } from "@typely/schemas";

/** Two-tier local setup from docs/development/ollama-benchmark.md ("Recommended configuration"). */
export const FAST_PROVIDER_ID = "local-fast";
export const QUALITY_PROVIDER_ID = "local-quality";
export const FAST_MODEL = "gemma3:1b";
export const QUALITY_MODEL = "gemma3:4b";

/** Below this, only the 1B model is offered (the 4B needs ~4.5 GB while it runs). */
export const QUALITY_MODEL_MIN_MEMORY = 24 * 1024 ** 3;

export interface LocalSetupPlan {
  engine: EngineSettings;
  /** Model tags the plan uses. */
  used: string[];
  /** Recommended models that are not installed (`ollama pull <tag>`). */
  missing: string[];
  /** The quality model was left out because this machine has too little memory. */
  lowMemory: boolean;
}

const hasModel = (installed: readonly string[], tag: string) =>
  installed.some((name) => name === tag || name === `${tag}:latest` || name.startsWith(`${tag}-`));

/**
 * Adds (or updates) the two local providers:
 * - `fix` → gemma3:1b, kept warm 5 minutes, plain text (the adapter defaults);
 * - every other operation → gemma3:4b, unloaded right after each request.
 * Other providers are kept, after the local ones.
 */
export function planLocalSetup(
  engine: EngineSettings,
  installed: readonly string[],
  totalMemoryBytes: number,
): LocalSetupPlan {
  const lowMemory = totalMemoryBytes > 0 && totalMemoryBytes < QUALITY_MODEL_MIN_MEMORY;
  const fast: ProviderConfig = {
    id: FAST_PROVIDER_ID,
    kind: "ollama",
    label: "Ollama · fast",
    model: FAST_MODEL,
    enabled: true,
    consent_granted: false,
  };
  const quality: ProviderConfig = {
    id: QUALITY_PROVIDER_ID,
    kind: "ollama",
    label: "Ollama · quality",
    model: QUALITY_MODEL,
    enabled: true,
    consent_granted: false,
    timeout_ms: 90_000,
    // Cannot meet the 2-second target anyway: do not hold 4.5 GB between requests.
    keep_alive_seconds: 0,
  };
  const local: ProviderConfig[] = [];
  const missing: string[] = [];
  if (hasModel(installed, FAST_MODEL)) local.push(fast);
  else missing.push(FAST_MODEL);
  if (!lowMemory) {
    if (hasModel(installed, QUALITY_MODEL)) local.push(quality);
    else missing.push(QUALITY_MODEL);
  }

  const localIds = new Set([FAST_PROVIDER_ID, QUALITY_PROVIDER_ID]);
  const others = engine.providers.filter((p) => !localIds.has(p.id));
  const providers = [...local, ...others];
  const order = [
    ...[QUALITY_PROVIDER_ID, FAST_PROVIDER_ID].filter((id) => local.some((p) => p.id === id)),
    ...(engine.provider_order.length > 0 ? engine.provider_order : others.map((p) => p.id)).filter(
      (id) => !localIds.has(id) && others.some((p) => p.id === id),
    ),
  ];
  const operationProviders: Partial<Record<Operation, string>> = Object.fromEntries(
    Object.entries(engine.operation_providers).filter(
      ([, id]) => id !== undefined && providers.some((p) => p.id === id) && !localIds.has(id),
    ),
  );
  if (local.some((p) => p.id === FAST_PROVIDER_ID)) operationProviders.fix = FAST_PROVIDER_ID;

  return {
    engine: {
      ...engine,
      providers,
      provider_order: order,
      operation_providers: operationProviders,
    },
    used: local.map((p) => p.model),
    missing,
    lowMemory,
  };
}

/** 1–2B models: fine for `fix`, unreliable for rewrites and translation (benchmark). */
export function isSmallModel(model: string): boolean {
  return /[:_-](?:0\.5|1|1\.5|2)b(?:\b|[-_])/i.test(model);
}

/** The provider an operation goes to first, mirroring the engine's chain order. */
export function headProvider(
  engine: EngineSettings,
  operation: Operation,
  usable: readonly ProviderConfig[],
): ProviderConfig | undefined {
  const byId = (id: string | undefined) => usable.find((p) => p.id === id);
  const override = byId(engine.operation_providers[operation]);
  if (override !== undefined) return override;
  const order = engine.provider_order.length > 0 ? engine.provider_order : usable.map((p) => p.id);
  for (const id of order) {
    const provider = byId(id);
    if (provider !== undefined) return provider;
  }
  return undefined;
}
