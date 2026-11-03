/**
 * Runs the grammar test set through the same engine as the panel (local rules, the bundled
 * word list, LanguageTool and an Ollama model) and scores each output.
 *
 *   node scripts/bench/grammar-suite.ts --lt http://127.0.0.1:18082 [--model gemma3:1b]
 *        [--mode hybrid|local] [--only fr-subj-venir,en-goes] [--failed results.json]
 *        [--out results.json]
 *   node scripts/bench/grammar-suite.ts --lt … --kind openai_compatible  *        --base-url https://api.groq.com/openai/v1 --model openai/gpt-oss-20b  *        --key-file .env --key-name groq-api-key --delay 2100
 *
 * A cloud model receives only the test sentences. Its key is read from a git-ignored
 * `key=value` file at run time and never printed; --delay spaces the requests out for
 * free-tier rate limits.
 *
 * Expects LanguageTool and (unless --mode local) Ollama to be running already; the script
 * never starts or downloads anything. The model is kept loaded for two minutes after the run.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  CorrectionEngine,
  endpointsFromSettings,
  WordListSpeller,
} from "@typely/correction-engine";
import { DirectTransport } from "@typely/provider-adapters";
import {
  type CorrectionResult,
  type EngineSettingsInput,
  ProviderKindSchema,
} from "@typely/schemas";
import { GRAMMAR_CORPUS, type GrammarCase } from "./grammar-corpus.ts";

interface Outcome {
  id: string;
  category: string;
  text: string;
  output: string;
  pass: boolean;
  missing: string[];
  left: string[];
  suggestions: string[];
  ms: number;
  error?: string;
}

const normalise = (s: string) => s.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ");

export function score(c: GrammarCase, output: string): Pick<Outcome, "pass" | "missing" | "left"> {
  const out = normalise(output);
  if (c.category === "correct") {
    const pass = output === c.text;
    return { pass, missing: pass ? [] : [c.text], left: [] };
  }
  const missing = c.expect
    .filter((e) => !(Array.isArray(e) ? e : [e]).some((alt) => out.includes(normalise(alt))))
    .map((e) => (Array.isArray(e) ? e.join(" | ") : e));
  const left = (c.forbid ?? []).filter((f) => out.includes(normalise(f)));
  return { pass: missing.length === 0 && left.length === 0, missing, left };
}

async function main() {
  const { values } = parseArgs({
    options: {
      lt: { type: "string" },
      model: { type: "string", default: "gemma3:1b" },
      mode: { type: "string", default: "hybrid" },
      only: { type: "string" },
      failed: { type: "string" },
      out: { type: "string" },
      kind: { type: "string", default: "ollama" },
      "base-url": { type: "string" },
      "key-file": { type: "string" },
      "key-name": { type: "string" },
      delay: { type: "string", default: "0" },
    },
  });
  const cloud = values.kind !== "ollama";
  const key =
    values["key-file"] === undefined
      ? undefined
      : readFileSync(values["key-file"], "utf8")
          .split(/\r?\n/)
          .map((line) => /^\s*([^=#\s]+)\s*=\s*"?([^"]*)"?\s*$/.exec(line))
          .find(
            (m) => m !== null && (values["key-name"] === undefined || m[1] === values["key-name"]),
          )?.[2];
  const settings: EngineSettingsInput = {
    default_mode: values.mode === "local" ? "local" : "hybrid",
    privacy: { cloud_processing_allowed: cloud },
    providers:
      values.mode === "local"
        ? []
        : [
            {
              id: "model",
              kind: ProviderKindSchema.parse(values.kind),
              label: values.kind ?? "ollama",
              model: values.model ?? "gemma3:1b",
              consent_granted: cloud,
              timeout_ms: 120_000,
              ...(cloud ? {} : { keep_alive_seconds: 120 }),
              ...(values["base-url"] === undefined ? {} : { base_url: values["base-url"] }),
            },
          ],
    ...(values.lt === undefined
      ? {}
      : { languagetool: { enabled: true, base_url: values.lt, consent_granted: false } }),
  };
  const transport = new DirectTransport({
    endpoints: endpointsFromSettings(settings),
    getSecret: (id) => (id === "model" ? key : undefined),
  });
  const speller = new WordListSpeller(() =>
    readFileSync(
      new URL("../../packages/correction-engine/data/en-words.txt", import.meta.url),
      "utf8",
    ),
  );
  const engine = new CorrectionEngine({ settings, transport, speller });

  let cases = GRAMMAR_CORPUS;
  if (values.only !== undefined) {
    const ids = new Set(values.only.split(","));
    cases = cases.filter((c) => ids.has(c.id));
  }
  if (values.failed !== undefined) {
    const previous = JSON.parse(readFileSync(values.failed, "utf8")) as Outcome[];
    const ids = new Set(previous.filter((o) => !o.pass).map((o) => o.id));
    cases = cases.filter((c) => ids.has(c.id));
  }

  const outcomes: Outcome[] = [];
  const delay = Number(values.delay);
  for (const c of cases) {
    if (delay > 0 && outcomes.length > 0) await new Promise((r) => setTimeout(r, delay));
    const started = performance.now();
    let result: CorrectionResult | undefined;
    let error: string | undefined;
    try {
      result = await engine.run({ operation: "fix", text: c.text });
    } catch (e) {
      error = String(e);
    }
    const output = result?.corrected_text ?? "";
    const unavailable = result?.warnings.find((w) => w.code === "languagetool_unavailable");
    if (unavailable !== undefined) error = unavailable.message;
    const outcome: Outcome = {
      id: c.id,
      category: c.category,
      text: c.text,
      output,
      ...score(c, output),
      suggestions: (result?.suggestions ?? []).map(
        (s) => `${s.original} → ${s.replacements.join(" | ")}`,
      ),
      ms: Math.round(performance.now() - started),
      ...(error === undefined ? {} : { error }),
    };
    outcomes.push(outcome);
    const mark = outcome.pass ? "PASS" : "FAIL";
    process.stdout.write(
      `${mark} ${c.id.padEnd(24)} ${output}${outcome.pass ? "" : `   [missing: ${outcome.missing.join(", ")}${outcome.left.length > 0 ? `; left: ${outcome.left.join(", ")}` : ""}]`}${outcome.suggestions.length > 0 ? `   {to check: ${outcome.suggestions.join("; ")}}` : ""}${error === undefined ? "" : `   !${error}`}\n`,
    );
  }

  const groups = new Map<string, { pass: number; total: number }>();
  for (const o of outcomes) {
    const key = `${o.id.slice(0, 2)} ${o.category}`;
    const g = groups.get(key) ?? { pass: 0, total: 0 };
    g.total++;
    if (o.pass) g.pass++;
    groups.set(key, g);
  }
  process.stdout.write("\n");
  for (const [key, g] of [...groups].sort())
    process.stdout.write(`${key.padEnd(28)} ${g.pass}/${g.total}\n`);
  const passed = outcomes.filter((o) => o.pass).length;
  const ms = outcomes.map((o) => o.ms).sort((a, b) => a - b);
  process.stdout.write(
    `\n${passed}/${outcomes.length} passed · median ${ms[Math.floor(ms.length / 2)] ?? 0} ms\n`,
  );
  if (values.out !== undefined) writeFileSync(values.out, JSON.stringify(outcomes, null, 2));
}

await main();
