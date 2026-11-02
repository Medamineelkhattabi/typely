import {
  AllProvidersFailedError,
  type ChainResult,
  type CompletionRequest,
  complete,
  createAdapter,
  type EndpointDefinition,
  isLoopbackUrl,
  LANGUAGETOOL_AUTH,
  LanguageToolClient,
  listModels,
  type ProviderAdapter,
  ProviderChain,
  type ProviderChainOptions,
  ProviderError,
  type Transport,
} from "@typely/provider-adapters";
import {
  type Attempt,
  type CheckResult,
  type CorrectionMode,
  type CorrectionRequest,
  CorrectionRequestSchema,
  type CorrectionResult,
  CorrectionResultSchema,
  type EngineSettings,
  type EngineSettingsInput,
  EngineSettingsSchema,
  type ExplanationItem,
  type FindingSource,
  type GrammarIssue,
  LLM_OUTPUT_JSON_SCHEMA,
  type LlmCorrectionOutput,
  type Operation,
  type ResultWarning,
  type Usage,
} from "@typely/schemas";
import { detectLanguage, type LanguageDetection } from "./detect.ts";
import { EngineError } from "./errors.ts";
import { runGuards } from "./guards.ts";
import {
  createDefaultRegistry,
  type LanguageRegistry,
  normalizeLanguageCode,
} from "./languages/registry.ts";
import { getOperation } from "./operations.ts";
import { parseLlmOutput } from "./parse.ts";
import {
  buildPrompt,
  buildRepairPrompt,
  estimateOutputTokens,
  type PromptInput,
  type PromptProfile,
  stripEchoedDelimiters,
} from "./prompts.ts";
import { fixLocally, mergeIssues, runLocalRules } from "./rules/index.ts";
import { diffWords } from "./text/diff.ts";

export const LANGUAGETOOL_ENDPOINT_ID = "languagetool";

export interface CorrectionEngineOptions {
  settings: EngineSettingsInput;
  /** Executes provider and LanguageTool requests; holds the secrets. */
  transport: Transport;
  registry?: LanguageRegistry;
  chain?: ProviderChainOptions;
  now?: () => number;
}

export interface RunOptions {
  signal?: AbortSignal;
}

export interface CheckOptions extends RunOptions {
  language?: string;
}

export type ProviderTestResult =
  | { ok: true; models: string[] }
  | { ok: false; errorKind: ProviderError["kind"]; message: string };

interface ResolvedLanguage {
  language: string;
  confidence: number;
  detection: LanguageDetection | undefined;
}

interface LocalFindings {
  issues: GrammarIssue[];
  layers: FindingSource[];
  warnings: ResultWarning[];
}

interface AiOutcome {
  output: LlmCorrectionOutput;
  model: string;
  usage: Usage | undefined;
  repaired: boolean;
}

/**
 * The shared correction engine used by the desktop app, the extension and the CLI.
 * It owns language detection, local rules, prompting, validation and guards; it never
 * sees API keys (those stay behind the Transport).
 */
export class CorrectionEngine {
  readonly settings: EngineSettings;
  readonly registry: LanguageRegistry;
  readonly #transport: Transport;
  readonly #adapters: ReadonlyMap<string, ProviderAdapter>;
  readonly #languageTool: LanguageToolClient | undefined;
  readonly #chainOptions: ProviderChainOptions;
  readonly #now: () => number;
  readonly #disabledRules: ReadonlySet<string>;

  constructor(options: CorrectionEngineOptions) {
    this.settings = EngineSettingsSchema.parse(options.settings);
    this.registry = options.registry ?? createDefaultRegistry();
    this.#transport = options.transport;
    this.#adapters = new Map(this.settings.providers.map((p) => [p.id, createAdapter(p)]));
    this.#chainOptions = options.chain ?? {};
    this.#now = options.now ?? (() => performance.now());
    this.#disabledRules = new Set(this.settings.disabled_rules);
    const lt = this.settings.languagetool;
    this.#languageTool =
      lt?.enabled === true
        ? new LanguageToolClient({
            transport: this.#transport,
            endpointId: LANGUAGETOOL_ENDPOINT_ID,
            ...(lt.username === undefined ? {} : { username: lt.username }),
          })
        : undefined;
  }

  detectLanguage(text: string): LanguageDetection {
    return detectLanguage(text, this.registry);
  }

  /** Deterministic check for inline indicators: local rules + LanguageTool, never an LLM. */
  async check(text: string, options: CheckOptions = {}): Promise<CheckResult> {
    this.#assertSize(text);
    const resolved = this.#resolveLanguage(text, options.language);
    const findings = await this.#localFindings(text, resolved.language, options.signal);
    return {
      detected_language: resolved.language,
      language_confidence: resolved.confidence,
      issues: findings.issues,
      warnings: findings.warnings,
    };
  }

  async run(input: CorrectionRequest, options: RunOptions = {}): Promise<CorrectionResult> {
    const started = this.#now();
    const parsed = CorrectionRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw new EngineError(
        "invalid_request",
        parsed.error.issues.map((i) => i.message).join("; "),
      );
    }
    const request = parsed.data;
    this.#assertSize(request.text);
    const operation = getOperation(request.operation);
    const mode: CorrectionMode = request.mode ?? this.settings.default_mode;
    const resolved = this.#resolveLanguage(request.text, request.language);
    const warnings: ResultWarning[] = [];
    if (resolved.detection?.mixed === true) {
      warnings.push({
        code: "mixed_language",
        message: `Mixed-language text detected (${resolved.language} + ${resolved.detection.secondary ?? "?"}).`,
      });
    }

    if (mode === "local") {
      if (operation.id !== "fix") {
        throw new EngineError(
          "requires_ai",
          `'${operation.label}' needs an AI provider; local mode only corrects.`,
        );
      }
      const findings = await this.#localFindings(request.text, resolved.language, options.signal);
      const fixed = fixLocally(
        request.text,
        resolved.language,
        this.registry.get(resolved.language),
        { disabledRules: this.#disabledRules },
        findings.issues,
      );
      return this.#finish({
        operation: operation.id,
        original: request.text,
        corrected: fixed.text,
        resolved,
        explanation: fixed.applied.map(toExplanation),
        confidence: findings.layers.includes("languagetool") ? 0.8 : 0.6,
        warnings: [...warnings, ...findings.warnings],
        meta: { mode, layers: findings.layers, attempts: [] },
        started,
      });
    }

    const adapters = this.#chainAdapters(operation.id, request.provider_id);
    const findings =
      mode === "hybrid"
        ? await this.#localFindings(request.text, resolved.language, options.signal)
        : { issues: [], layers: [], warnings: [] };
    warnings.push(...findings.warnings);

    const promptInput: PromptInput = {
      operation,
      text: request.text,
      language: resolved.language,
      ...(request.target_language === undefined ? {} : { targetLanguage: request.target_language }),
      ...(request.context === undefined
        ? {}
        : {
            context: {
              kind: request.context.kind,
              ...(request.context.app === undefined ? {} : { app: request.context.app }),
              ...(request.context.target_ai === undefined
                ? {}
                : { targetAi: request.context.target_ai }),
            },
          }),
      hints: findings.issues,
    };
    // The prompt depends on the provider (compact for small local models), so it is built
    // per attempt rather than once for the whole chain.
    const completionFor = (adapter: ProviderAdapter): CompletionRequest => ({
      ...buildPrompt({ ...promptInput, profile: promptProfile(adapter) }, this.registry),
      jsonSchema: { name: "typely_correction", schema: LLM_OUTPUT_JSON_SCHEMA },
      suggestedMaxOutputTokens: estimateOutputTokens(request.text, operation),
    });

    const chain = new ProviderChain(adapters, {
      maxRetries: this.settings.limits.max_retries,
      ...this.#chainOptions,
    });
    let chainResult: ChainResult<AiOutcome>;
    try {
      chainResult = await chain.run(
        (adapter, signal) => this.#completeAndParse(adapter, completionFor(adapter), signal),
        options.signal,
      );
    } catch (error) {
      throw toEngineError(error);
    }
    const { value: outcome, adapter, attempts } = chainResult;

    let corrected = stripEchoedDelimiters(outcome.output.corrected_text, request.text);
    const explanation: ExplanationItem[] = outcome.output.explanation
      .filter((e) => e.original !== e.corrected)
      .map((e) => ({ ...e, source: "ai" as const }));
    const layers: FindingSource[] = [...findings.layers, "ai"];

    // Hybrid fix: deterministic rules get the last word on what they are certain about.
    if (mode === "hybrid" && operation.id === "fix") {
      const profile = this.registry.get(resolved.language);
      const fixed = fixLocally(corrected, resolved.language, profile, {
        disabledRules: this.#disabledRules,
      });
      explanation.push(...fixed.applied.map(toExplanation));
      corrected = fixed.text;
    }

    if (adapter !== adapters[0]) {
      warnings.push({
        code: "provider_fallback",
        message: `Processed by fallback provider '${adapter.config.label}' after earlier providers failed.`,
      });
    }
    if (outcome.repaired) {
      warnings.push({
        code: "repaired_response",
        message: "The provider's response had to be repaired.",
      });
    }
    for (const note of outcome.output.warnings) {
      if (note.trim()) warnings.push({ code: "model_warning", message: note.trim() });
    }
    if (outcome.output.confidence < 0.5) {
      warnings.push({
        code: "low_confidence",
        message: "The assistant is not confident in this result.",
      });
    }

    const changes = diffWords(request.text, corrected);
    warnings.push(
      ...runGuards(
        {
          operation,
          original: request.text,
          corrected,
          sourceLanguage: resolved.language,
          sourceConfidence: resolved.confidence,
          ...(request.target_language === undefined
            ? {}
            : { targetLanguage: request.target_language }),
          changes,
        },
        this.registry,
      ),
    );

    const modelLanguage = normalizeLanguageCode(outcome.output.detected_language);
    const finalLanguage =
      resolved.language === "und" && modelLanguage !== "und"
        ? { ...resolved, language: modelLanguage, confidence: Math.max(resolved.confidence, 0.5) }
        : resolved;

    return this.#finish({
      operation: operation.id,
      original: request.text,
      corrected,
      resolved: finalLanguage,
      explanation,
      confidence: outcome.output.confidence,
      warnings,
      changes,
      meta: {
        mode,
        layers,
        provider_id: adapter.config.id,
        model: outcome.model,
        ...(outcome.usage === undefined ? {} : { usage: outcome.usage }),
        attempts: attempts.map(toAttempt),
        prompt_version: operation.promptVersion,
      },
      started,
    });
  }

  /** "Test connection": lists models with the stored credentials. Sends no user text. */
  async testProvider(providerId: string, options: RunOptions = {}): Promise<ProviderTestResult> {
    const adapter = this.#adapters.get(providerId);
    if (adapter === undefined) {
      return {
        ok: false,
        errorKind: "not_configured",
        message: `Unknown provider '${providerId}'`,
      };
    }
    try {
      return { ok: true, models: await listModels(adapter, this.#transport, options.signal) };
    } catch (error) {
      if (error instanceof ProviderError)
        return { ok: false, errorKind: error.kind, message: error.message };
      throw error;
    }
  }

  async #completeAndParse(
    adapter: ProviderAdapter,
    request: CompletionRequest,
    signal?: AbortSignal,
  ): Promise<AiOutcome> {
    const first = await complete(adapter, this.#transport, request, signal);
    let usage = first.usage;
    let parsed = parseLlmOutput(first.text);
    if (parsed.ok)
      return { output: parsed.value, model: first.model, usage: toUsage(usage), repaired: false };

    const repairPrompt = buildRepairPrompt(first.text, parsed.problem);
    const second = await complete(
      adapter,
      this.#transport,
      { ...request, ...repairPrompt },
      signal,
    );
    usage = addUsage(usage, second.usage);
    parsed = parseLlmOutput(second.text);
    if (!parsed.ok) {
      throw new ProviderError(
        "invalid_response",
        adapter.config.id,
        `Unusable response: ${parsed.problem}`,
      );
    }
    return { output: parsed.value, model: second.model, usage: toUsage(usage), repaired: true };
  }

  #chainAdapters(operation: Operation, override: string | undefined): ProviderAdapter[] {
    const ordered = (
      this.settings.provider_order.length > 0
        ? this.settings.provider_order
        : this.settings.providers.map((p) => p.id)
    )
      .map((id) => this.#adapters.get(id))
      .filter((a): a is ProviderAdapter => a?.config.enabled === true);

    const headId = override ?? this.settings.operation_providers[operation];
    if (override !== undefined && !this.#adapters.has(override)) {
      throw new EngineError("invalid_request", `Unknown provider '${override}'`);
    }
    if (headId !== undefined) {
      const head = this.#adapters.get(headId);
      if (head?.config.enabled === true) {
        const index = ordered.indexOf(head);
        if (index !== -1) ordered.splice(index, 1);
        ordered.unshift(head);
      }
    }
    if (ordered.length === 0)
      throw new EngineError("no_provider", "No AI provider is configured and enabled.");

    const blocked = ordered.filter((a) => !this.#cloudAllowed(a.isLocal, a.config.consent_granted));
    const allowed = ordered.filter((a) => !blocked.includes(a));
    if (allowed.length === 0) {
      throw new EngineError(
        "consent_required",
        "Cloud processing is not allowed for the configured providers. Enable it in Privacy settings.",
        { providerIds: blocked.map((a) => a.config.id) },
      );
    }
    return allowed;
  }

  #cloudAllowed(isLocal: boolean, consentGranted: boolean): boolean {
    return isLocal || (this.settings.privacy.cloud_processing_allowed && consentGranted);
  }

  async #localFindings(
    text: string,
    language: string,
    signal?: AbortSignal,
  ): Promise<LocalFindings> {
    const profile = this.registry.get(language);
    const local = runLocalRules(text, language, profile, { disabledRules: this.#disabledRules });
    const layers: FindingSource[] = ["local"];
    const warnings: ResultWarning[] = [];
    const lt = this.settings.languagetool;
    if (this.#languageTool === undefined || lt === undefined)
      return { issues: local, layers, warnings };

    if (!this.#cloudAllowed(isLoopbackUrl(lt.base_url), lt.consent_granted)) {
      warnings.push({
        code: "languagetool_unavailable",
        message: "LanguageTool skipped: cloud processing has not been allowed for this server.",
      });
      return { issues: local, layers, warnings };
    }
    try {
      const remote = await this.#languageTool.check(text, language, signal);
      layers.push("languagetool");
      return { issues: mergeIssues(local, remote), layers, warnings };
    } catch (error) {
      if (signal?.aborted)
        throw new EngineError("cancelled", "Request cancelled", { cause: error });
      if (!(error instanceof ProviderError)) throw error;
      warnings.push({
        code: "languagetool_unavailable",
        message: `LanguageTool unavailable: ${error.message}`,
      });
      return { issues: local, layers, warnings };
    }
  }

  #resolveLanguage(text: string, override: string | undefined): ResolvedLanguage {
    if (override !== undefined)
      return { language: normalizeLanguageCode(override), confidence: 1, detection: undefined };
    const detection = detectLanguage(text, this.registry);
    const preferred = this.settings.preferred_language;
    if (detection.language === "und" && preferred !== "auto") {
      return { language: preferred, confidence: 0.3, detection };
    }
    return { language: detection.language, confidence: detection.confidence, detection };
  }

  #assertSize(text: string): void {
    const max = this.settings.limits.max_input_chars;
    if (text.length > max) {
      throw new EngineError(
        "input_too_large",
        `Text is ${text.length} characters; the limit is ${max}.`,
      );
    }
  }

  #finish(parts: {
    operation: Operation;
    original: string;
    corrected: string;
    resolved: ResolvedLanguage;
    explanation: ExplanationItem[];
    confidence: number;
    warnings: ResultWarning[];
    changes?: CorrectionResult["changes"];
    meta: Omit<CorrectionResult["meta"], "duration_ms">;
    started: number;
  }): CorrectionResult {
    const warnings = [...parts.warnings];
    if (parts.corrected === parts.original)
      warnings.push({ code: "no_changes", message: "No changes were needed." });
    // Validating our own output catches engine bugs before they reach a UI.
    return CorrectionResultSchema.parse({
      operation: parts.operation,
      detected_language: parts.resolved.language,
      language_confidence: parts.resolved.confidence,
      corrected_text: parts.corrected,
      explanation: parts.explanation,
      confidence: parts.confidence,
      warnings,
      changes: parts.changes ?? diffWords(parts.original, parts.corrected),
      meta: { ...parts.meta, duration_ms: Math.max(0, Math.round(this.#now() - parts.started)) },
    });
  }
}

/** Endpoint table for transports (DirectTransport, or serialised for the Rust executor). */
export function endpointsFromSettings(
  settingsInput: EngineSettingsInput,
): Map<string, EndpointDefinition> {
  const settings = EngineSettingsSchema.parse(settingsInput);
  const endpoints = new Map<string, EndpointDefinition>();
  for (const provider of settings.providers) {
    const adapter = createAdapter(provider);
    endpoints.set(provider.id, { baseUrl: adapter.baseUrl, auth: adapter.auth });
  }
  if (settings.languagetool !== undefined) {
    endpoints.set(LANGUAGETOOL_ENDPOINT_ID, {
      baseUrl: settings.languagetool.base_url,
      auth: LANGUAGETOOL_AUTH,
    });
  }
  return endpoints;
}

function promptProfile(adapter: ProviderAdapter): PromptProfile {
  return adapter.config.prompt_profile ?? (adapter.isLocal ? "compact" : "full");
}

function toExplanation({
  original,
  issue,
}: {
  original: string;
  issue: GrammarIssue;
}): ExplanationItem {
  return {
    original,
    corrected: issue.replacements[0] ?? "",
    reason: issue.message,
    category: issue.category,
    source: issue.source,
  };
}

function toAttempt(a: {
  providerId: string;
  outcome: "success" | "error";
  errorKind?: string;
  durationMs: number;
}): Attempt {
  return {
    provider_id: a.providerId,
    outcome: a.outcome,
    ...(a.errorKind === undefined ? {} : { error_kind: a.errorKind }),
    duration_ms: Math.max(0, Math.round(a.durationMs)),
  };
}

function toUsage(
  usage: { inputTokens: number; outputTokens: number } | undefined,
): Usage | undefined {
  return usage === undefined
    ? undefined
    : { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens };
}

function addUsage(
  a: { inputTokens: number; outputTokens: number } | undefined,
  b: { inputTokens: number; outputTokens: number } | undefined,
): { inputTokens: number; outputTokens: number } | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  };
}

function toEngineError(error: unknown): unknown {
  if (error instanceof ProviderError && error.kind === "cancelled") {
    return new EngineError("cancelled", "Request cancelled", { cause: error });
  }
  if (error instanceof AllProvidersFailedError) {
    return new EngineError("provider_failed", error.message, {
      cause: error,
      providerIds: error.errors.map((e) => e.providerId),
    });
  }
  return error;
}
