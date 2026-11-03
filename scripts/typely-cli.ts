/**
 * Developer CLI for the shared correction engine.
 *
 *   npm run typely -- fix "i think teh report are ready"
 *   npm run typely -- translate --to en "Bonjour à tous"
 *   echo "texte" | npm run typely -- professional --json
 *
 * Configuration (environment variables — nothing is stored):
 *   TYPELY_PROVIDER        anthropic | openai | openai_compatible | gemini | ollama  (omit for local-only)
 *   TYPELY_MODEL           model id, e.g. gemma3:1b or llama3.2
 *   TYPELY_BASE_URL        optional endpoint override (required for openai_compatible)
 *   TYPELY_API_KEY         API key (or ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY)
 *   TYPELY_CLOUD_CONSENT   set to 1 to allow sending text to a non-local provider
 *   TYPELY_LANGUAGETOOL_URL optional LanguageTool server, e.g. http://localhost:8081
 */
import { parseArgs } from "node:util";
import { CorrectionEngine, EngineError, endpointsFromSettings } from "@typely/correction-engine";
import { DirectTransport } from "@typely/provider-adapters";
import {
  type CorrectionMode,
  CorrectionModeSchema,
  type EngineSettingsInput,
  OPERATIONS,
  type Operation,
  OperationSchema,
  ProviderKindSchema,
} from "@typely/schemas";

const KEY_VARIABLES: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
};

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      mode: { type: "string" },
      lang: { type: "string" },
      to: { type: "string" },
      provider: { type: "string" },
      json: { type: "boolean", default: false },
      stream: { type: "boolean", default: false },
      check: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const [operationArg, ...textParts] = positionals;
  if (values.help || operationArg === undefined) {
    process.stdout.write(
      `Usage: npm run typely -- <${OPERATIONS.join("|")}> [--mode local|ai|hybrid] [--lang fr] [--to en] [--json] [--check] [--stream] "text"\n`,
    );
    return values.help ? 0 : 2;
  }
  const operation = OperationSchema.safeParse(operationArg);
  if (!operation.success) {
    process.stderr.write(
      `Unknown operation '${operationArg}'. Expected one of: ${OPERATIONS.join(", ")}\n`,
    );
    return 2;
  }
  const text = textParts.length > 0 ? textParts.join(" ") : await readStdin();
  if (text.trim() === "") {
    process.stderr.write("No text given (pass it as an argument or on stdin).\n");
    return 2;
  }

  const env = process.env;
  const kind = values.provider ?? env["TYPELY_PROVIDER"];
  const settings: EngineSettingsInput = {
    default_mode: kind === undefined ? "local" : "hybrid",
    privacy: { cloud_processing_allowed: env["TYPELY_CLOUD_CONSENT"] === "1" },
    providers: [],
  };
  let secret: string | undefined;
  if (kind !== undefined) {
    const providerKind = ProviderKindSchema.parse(kind);
    const model = env["TYPELY_MODEL"];
    if (model === undefined) {
      process.stderr.write("TYPELY_MODEL is required when TYPELY_PROVIDER is set.\n");
      return 2;
    }
    settings.providers = [
      {
        id: "cli",
        kind: providerKind,
        label: providerKind,
        model,
        consent_granted: env["TYPELY_CLOUD_CONSENT"] === "1",
        ...(env["TYPELY_BASE_URL"] === undefined ? {} : { base_url: env["TYPELY_BASE_URL"] }),
      },
    ];
    const keyVariable = KEY_VARIABLES[providerKind];
    secret = env["TYPELY_API_KEY"] ?? (keyVariable === undefined ? undefined : env[keyVariable]);
  }
  if (env["TYPELY_LANGUAGETOOL_URL"] !== undefined) {
    settings.languagetool = {
      enabled: true,
      base_url: env["TYPELY_LANGUAGETOOL_URL"],
      consent_granted: true,
    };
  }

  const transport = new DirectTransport({
    endpoints: endpointsFromSettings(settings),
    getSecret: (id) => (id === "cli" ? secret : undefined),
  });
  const engine = new CorrectionEngine({ settings, transport });
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());

  try {
    if (values.check) {
      const result = await engine.check(text, {
        signal: controller.signal,
        ...(values.lang ? { language: values.lang } : {}),
      });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return 0;
    }
    const mode: CorrectionMode | undefined =
      values.mode === undefined ? undefined : CorrectionModeSchema.parse(values.mode);
    const started = performance.now();
    let firstWordsMs: number | undefined;
    let printed = "";
    const result = await engine.run(
      {
        operation: operation.data as Operation,
        text,
        ...(mode === undefined ? {} : { mode }),
        ...(values.lang === undefined ? {} : { language: values.lang }),
        ...(values.to === undefined ? {} : { target_language: values.to }),
      },
      {
        signal: controller.signal,
        ...(values.stream
          ? {
              onLocalPreview: (preview) =>
                process.stderr.write(
                  `[local ${Math.round(performance.now() - started)} ms] ${preview.corrected_text}\n`,
                ),
              onPartialText: (partial) => {
                if (firstWordsMs === undefined) {
                  firstWordsMs = Math.round(performance.now() - started);
                  process.stderr.write(`[first words ${firstWordsMs} ms] `);
                }
                // Print only the new suffix; restart the line if a fallback provider took over.
                if (partial.startsWith(printed))
                  process.stderr.write(partial.slice(printed.length));
                else process.stderr.write(`\n${partial}`);
                printed = partial;
              },
            }
          : {}),
      },
    );
    if (values.stream) process.stderr.write("\n");
    if (values.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return 0;
    }
    process.stdout.write(`${result.corrected_text}\n`);
    const via =
      result.meta.provider_id === undefined
        ? result.meta.mode
        : `${result.meta.provider_id} · ${result.meta.model}`;
    process.stderr.write(
      `\n— ${result.detected_language} (${Math.round(result.language_confidence * 100)}%) · ${via} · ${result.meta.duration_ms} ms\n`,
    );
    for (const item of result.explanation) {
      process.stderr.write(
        `  • ${JSON.stringify(item.original)} → ${JSON.stringify(item.corrected)}: ${item.reason} [${item.source}]\n`,
      );
    }
    for (const warning of result.warnings)
      process.stderr.write(`  ! ${warning.code}: ${warning.message}\n`);
    return 0;
  } catch (error) {
    if (error instanceof EngineError) {
      process.stderr.write(`Error (${error.code}): ${error.message}\n`);
      return 1;
    }
    throw error;
  }
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

process.exitCode = await main();
