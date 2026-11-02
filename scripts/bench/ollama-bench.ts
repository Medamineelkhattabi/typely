/**
 * Real-hardware validation of the Ollama integration.
 *
 *   node scripts/bench/ollama-bench.ts startup  --model gemma3:1b
 *   node scripts/bench/ollama-bench.ts bench    --models gemma3:1b,qwen3.5:2b [--out results.json]
 *   node scripts/bench/ollama-bench.ts failures --model gemma3:1b
 *
 * Expects an Ollama server at OLLAMA_URL (default http://127.0.0.1:11434). The script never
 * pulls models or starts the server itself.
 */
import { writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { parseArgs } from "node:util";
import { CorrectionEngine, EngineError, endpointsFromSettings } from "@typely/correction-engine";
import {
  DirectTransport,
  type ProviderHttpRequest,
  type ProviderHttpResponse,
  type Transport,
} from "@typely/provider-adapters";
import type { CorrectionResult, EngineSettingsInput, ProviderConfigInput } from "@typely/schemas";
import { type BenchCase, CORPUS } from "./corpus.ts";
import { InterferenceProbe, percentile } from "./probe.ts";
import { ProcessSampler, summarise, type WindowStats } from "./sampler.ts";

const OLLAMA_URL = process.env["OLLAMA_URL"] ?? "http://127.0.0.1:11434";
const LOGICAL_CPUS = cpus().length;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Keeps the raw Ollama responses so Ollama's own timings can be reported. */
class RecordingTransport implements Transport {
  readonly responses: ProviderHttpResponse[] = [];
  readonly #inner: Transport;
  constructor(inner: Transport) {
    this.#inner = inner;
  }
  async send(id: string, request: ProviderHttpRequest, signal?: AbortSignal) {
    const response = await this.#inner.send(id, request, signal);
    if (request.path === "/api/chat") this.responses.push(response);
    return response;
  }
}

function provider(model: string, extra: Partial<ProviderConfigInput> = {}): ProviderConfigInput {
  return {
    id: extra.id ?? "ollama",
    kind: "ollama",
    label: "Ollama",
    model,
    base_url: OLLAMA_URL,
    ...extra,
  };
}

function makeEngine(providers: ProviderConfigInput[], mode: "ai" | "hybrid" = "hybrid") {
  const settings: EngineSettingsInput = { default_mode: mode, providers };
  const recorder = new RecordingTransport(
    new DirectTransport({ endpoints: endpointsFromSettings(settings), getSecret: () => undefined }),
  );
  return { engine: new CorrectionEngine({ settings, transport: recorder }), recorder };
}

async function loadedModels(): Promise<string[]> {
  const res = await fetch(`${OLLAMA_URL}/api/ps`);
  const body = (await res.json()) as { models?: Array<{ name: string }> };
  return (body.models ?? []).map((m) => m.name);
}

/** Polls /api/ps until no model is resident; returns the time it took (ms) or -1. */
async function waitForUnload(timeoutMs = 15_000): Promise<number> {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    if ((await loadedModels()).length === 0) return Math.round(performance.now() - started);
    await sleep(100);
  }
  return -1;
}

const ns = (value: unknown) => (typeof value === "number" ? Math.round(value / 1e6) : 0);

interface CaseResult {
  id: string;
  language: string;
  operation: string;
  ok: boolean;
  error?: string;
  wallMs: number;
  loadMs: number;
  promptEvalMs: number;
  evalMs: number;
  promptTokens: number;
  outputTokens: number;
  tokensPerSecond: number;
  calls: number;
  unloadMs: number;
  stats: WindowStats;
  probe: { p50: number; p95: number };
  quality: { expectHit: number; expectTotal: number; forbidLeft: string[]; keepLost: string[] };
  detected?: string;
  warnings?: string[];
  output?: string;
}

function score(c: BenchCase, result: CorrectionResult) {
  const out = result.corrected_text;
  return {
    expectHit: c.expect.filter((e) => out.includes(e)).length,
    expectTotal: c.expect.length,
    forbidLeft: c.forbid.filter((f) => out.includes(f)),
    keepLost: c.keep.filter((k) => !out.includes(k)),
  };
}

async function runCase(
  model: string,
  c: BenchCase,
  sampler: ProcessSampler,
  probe: InterferenceProbe,
  extra: Partial<ProviderConfigInput> = {},
): Promise<CaseResult> {
  const { engine, recorder } = makeEngine([provider(model, extra)]);
  const mark = sampler.mark();
  const startedAt = Date.now();
  const started = performance.now();
  let result: CorrectionResult | undefined;
  let error: string | undefined;
  try {
    result = await engine.run(c.request);
  } catch (e) {
    error = e instanceof EngineError ? `${e.code}: ${e.message}` : String(e);
  }
  const wallMs = Math.round(performance.now() - started);
  const endedAt = Date.now();
  const unloadMs = await waitForUnload();
  await sleep(400); // let the sampler see the runner exit
  const bodies = recorder.responses.map((r) => r.body as Record<string, unknown>);
  const sum = (key: string) => bodies.reduce((acc, b) => acc + ns(b[key]), 0);
  const count = (key: string) =>
    bodies.reduce((acc, b) => acc + (typeof b[key] === "number" ? (b[key] as number) : 0), 0);
  const evalMs = sum("eval_duration");
  const outputTokens = count("eval_count");
  const probeMs = probe.between(startedAt, endedAt);
  return {
    id: c.id,
    language: c.language,
    operation: c.request.operation,
    ok: result !== undefined,
    ...(error === undefined ? {} : { error }),
    wallMs,
    loadMs: sum("load_duration"),
    promptEvalMs: sum("prompt_eval_duration"),
    evalMs,
    promptTokens: count("prompt_eval_count"),
    outputTokens,
    tokensPerSecond: evalMs > 0 ? Math.round((outputTokens / evalMs) * 10_000) / 10 : 0,
    calls: bodies.length,
    unloadMs,
    stats: summarise(sampler.window(mark), LOGICAL_CPUS),
    probe: { p50: round1(percentile(probeMs, 50)), p95: round1(percentile(probeMs, 95)) },
    quality: result
      ? score(c, result)
      : { expectHit: 0, expectTotal: c.expect.length, forbidLeft: [], keepLost: [] },
    ...(result
      ? {
          detected: result.detected_language,
          warnings: result.warnings.map((w) => w.code),
          output: result.corrected_text,
        }
      : {}),
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

async function idleBaseline(sampler: ProcessSampler, probe: InterferenceProbe, ms = 3000) {
  const mark = sampler.mark();
  const from = Date.now();
  await sleep(ms);
  const probeMs = probe.between(from, Date.now());
  return {
    stats: summarise(sampler.window(mark), LOGICAL_CPUS),
    probe: { p50: round1(percentile(probeMs, 50)), p95: round1(percentile(probeMs, 95)) },
  };
}

async function bench(
  models: string[],
  out: string | undefined,
  onlyCases?: string[],
  repeat = 1,
  extra: Partial<ProviderConfigInput> = {},
) {
  const sampler = new ProcessSampler();
  const probe = new InterferenceProbe();
  await sampler.start();
  await probe.start();
  const report: Record<string, unknown> = { ollamaUrl: OLLAMA_URL, logicalCpus: LOGICAL_CPUS };
  try {
    if ((await loadedModels()).length > 0)
      throw new Error("A model is already loaded; unload it first.");
    report["idle"] = await idleBaseline(sampler, probe);
    console.log("idle (server only, no model):", JSON.stringify(report["idle"]));
    const cases = CORPUS.filter((c) => onlyCases === undefined || onlyCases.includes(c.id));
    for (const model of models) {
      const results: CaseResult[] = [];
      for (const c of cases.flatMap((x) => Array.from({ length: repeat }, () => x))) {
        const r = await runCase(model, c, sampler, probe, extra);
        results.push(r);
        console.log(
          `${model} ${r.id}: ${r.ok ? "ok" : `FAIL ${r.error}`} wall=${r.wallMs}ms load=${r.loadMs}ms ` +
            `gen=${r.evalMs}ms ${r.tokensPerSecond}tok/s ram=${r.stats.peakWorkingSetMB}MB ` +
            `cpu=${r.stats.avgCpuPercent}%/${r.stats.peakCpuPercent}% unload=${r.unloadMs}ms ` +
            `quality=${r.quality.expectHit}/${r.quality.expectTotal}` +
            `${r.quality.forbidLeft.length ? ` left=${JSON.stringify(r.quality.forbidLeft)}` : ""}` +
            `${r.quality.keepLost.length ? ` lost=${JSON.stringify(r.quality.keepLost)}` : ""}`,
        );
        console.log(`   → ${JSON.stringify(r.output ?? r.error)}`);
      }
      report[model] = results;
    }
    report["idleAfter"] = await idleBaseline(sampler, probe);
  } finally {
    sampler.stop();
    await probe.stop();
  }
  if (out !== undefined) writeFileSync(out, JSON.stringify(report, null, 2));
}

async function startup(model: string) {
  const sampler = new ProcessSampler();
  await sampler.start();
  const before = await loadedModels();
  const { engine } = makeEngine([provider(model)]);
  const test = await engine.testProvider("ollama");
  const afterTest = await loadedModels();
  // Inline checks must never touch the model.
  await engine.check("Teh report is ready , thanks");
  const afterCheck = await loadedModels();
  await sleep(1500);
  const stats = summarise(sampler.window(0), LOGICAL_CPUS);
  sampler.stop();
  console.log(
    JSON.stringify(
      {
        loadedAtStart: before,
        testProvider: test.ok ? `ok (${test.models.length} models)` : test,
        loadedAfterTestProvider: afterTest,
        loadedAfterInlineCheck: afterCheck,
        serverIdle: stats,
      },
      null,
      2,
    ),
  );
}

async function failures(model: string) {
  const sampler = new ProcessSampler();
  await sampler.start();
  const run = async (name: string, providers: ProviderConfigInput[], signal?: AbortSignal) => {
    const { engine } = makeEngine(providers);
    const started = performance.now();
    try {
      const r = await engine.run(
        { operation: "fix", text: "Their going to send it tomorow." },
        signal ? { signal } : {},
      );
      return {
        name,
        outcome: "success",
        provider: r.meta.provider_id,
        attempts: r.meta.attempts.map(
          (a) => `${a.provider_id}:${a.outcome}${a.error_kind ? `(${a.error_kind})` : ""}`,
        ),
        warnings: r.warnings.map((w) => w.code),
        ms: Math.round(performance.now() - started),
      };
    } catch (e) {
      return {
        name,
        outcome: e instanceof EngineError ? `EngineError(${e.code})` : `UNEXPECTED ${String(e)}`,
        message: e instanceof Error ? e.message : String(e),
        ms: Math.round(performance.now() - started),
      };
    }
  };

  const results: unknown[] = [];
  results.push(
    await run("server unreachable", [provider(model, { base_url: "http://127.0.0.1:11999" })]),
  );
  results.push(await run("model not installed", [provider("typely-missing-model:latest")]));
  results.push(await run("timeout (300 ms)", [provider(model, { timeout_ms: 300 })]));
  results.push({ name: "  model unloaded after timeouts", unloadMs: await waitForUnload() });

  const controller = new AbortController();
  const cancelMark = sampler.mark();
  setTimeout(() => controller.abort(), 1500);
  results.push(await run("user cancels after 1.5 s", [provider(model)], controller.signal));
  const unloadAfterCancel = await waitForUnload();
  await sleep(1000);
  const afterCancel = sampler.window(sampler.mark() - 5);
  results.push({
    name: "  after cancel",
    unloadMs: unloadAfterCancel,
    ollamaCpuLastSecond: summarise(afterCancel, LOGICAL_CPUS).avgCpuPercent,
    peakDuring: summarise(sampler.window(cancelMark), LOGICAL_CPUS),
  });

  results.push(
    await run("fallback: missing model → working model", [
      provider("typely-missing-model:latest", { id: "broken" }),
      provider(model, { id: "working" }),
    ]),
  );
  results.push({ name: "  model unloaded at end", unloadMs: await waitForUnload() });
  sampler.stop();
  console.log(JSON.stringify(results, null, 2));
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    model: { type: "string" },
    models: { type: "string" },
    out: { type: "string" },
    cases: { type: "string" },
    repeat: { type: "string" },
    temperature: { type: "string" },
  },
});
const command = positionals[0];
if (command === "bench") {
  await bench(
    (values.models ?? values.model ?? "").split(",").filter(Boolean),
    values.out,
    values.cases?.split(","),
    values.repeat === undefined ? 1 : Number(values.repeat),
    values.temperature === undefined ? {} : { temperature: Number(values.temperature) },
  );
} else if (command === "startup" && values.model) {
  await startup(values.model);
} else if (command === "failures" && values.model) {
  await failures(values.model);
} else {
  console.error("Usage: ollama-bench.ts <bench|startup|failures> --model(s) …");
  process.exitCode = 2;
}
