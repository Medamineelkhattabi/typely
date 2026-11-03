import { useCallback, useEffect, useState } from "react";
import { describeError } from "../errors.ts";
import { detectOllama, type OllamaStatus } from "../ipc.ts";
import {
  FAST_MODEL,
  FAST_PROVIDER_ID,
  planLocalSetup,
  QUALITY_MODEL,
  QUALITY_PROVIDER_ID,
} from "../local-setup.ts";
import type { AppSettings } from "../settings.ts";
import type { UpdateSettings } from "./App.tsx";

const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

export function LocalAiPage({
  settings,
  update,
}: {
  settings: AppSettings;
  update: UpdateSettings;
}) {
  const [status, setStatus] = useState<OllamaStatus>();
  const [error, setError] = useState<string>();
  const [applied, setApplied] = useState<string>();

  // Listing models (/api/tags, /api/ps) never loads one.
  const detect = useCallback(() => {
    setError(undefined);
    detectOllama()
      .then(setStatus)
      .catch((e: unknown) => setError(describeError(e)));
  }, []);
  useEffect(detect, [detect]);

  const installed = status?.models.map((m) => m.name) ?? [];
  const plan =
    status === undefined
      ? undefined
      : planLocalSetup(settings.engine, installed, status.total_memory_bytes);
  const configured = settings.engine.providers.filter(
    (p) => p.id === FAST_PROVIDER_ID || p.id === QUALITY_PROVIDER_ID,
  );

  return (
    <>
      <h2>Local AI (Ollama)</h2>
      <p>
        A local model keeps your text on this computer. Typely does not bundle or install Ollama; it
        uses one you run yourself on <code>127.0.0.1:11434</code>. Models are loaded only when you
        ask for a correction, never at startup or while you type.
      </p>
      <div className="row">
        <button type="button" onClick={detect}>
          Detect again
        </button>
      </div>
      {error !== undefined && <p className="error">{error}</p>}
      {status !== undefined && !status.running && (
        <div className="notice">
          <p>
            Ollama is not running ({status.error ?? "no answer"}). Start it with these settings for
            the integrated GPU and no cloud models:
          </p>
          <pre>
            set OLLAMA_HOST=127.0.0.1:11434{"\n"}set OLLAMA_IGPU_ENABLE=1{"\n"}set OLLAMA_NO_CLOUD=1
            {"\n"}ollama serve
          </pre>
        </div>
      )}
      {status?.running === true && plan !== undefined && (
        <>
          <p>
            Ollama {status.version ?? ""} is running. This computer has{" "}
            {gb(status.total_memory_bytes)} of memory.
            {status.loaded.length > 0 && ` In memory now: ${status.loaded.join(", ")}.`}
          </p>
          <table>
            <thead>
              <tr>
                <th>Installed model</th>
                <th>Size</th>
              </tr>
            </thead>
            <tbody>
              {status.models.map((m) => (
                <tr key={m.name}>
                  <td>{m.name}</td>
                  <td>{gb(m.size_bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3>Recommended setup</h3>
          <ul>
            <li>
              <strong>Fix</strong> → {FAST_MODEL}: fast, kept in memory for 5 minutes after use
              (~1.4 GB), plain-text answers.
            </li>
            <li>
              <strong>Rewrite, tone, translate…</strong> →{" "}
              {plan.lowMemory
                ? `${FAST_MODEL} as well (experimental: this computer has too little memory for ${QUALITY_MODEL})`
                : `${QUALITY_MODEL}: better quality, ~15 s, unloaded right after each request (~4.5 GB while it runs).`}
            </li>
            <li>Each falls back to the other model if one fails.</li>
          </ul>
          {plan.missing.length > 0 && (
            <div className="notice">
              <p>Not installed yet (a large download, so Typely does not do it for you):</p>
              <pre>{plan.missing.map((m) => `ollama pull ${m}`).join("\n")}</pre>
            </div>
          )}
          <div className="row">
            <button
              type="button"
              className="primary"
              disabled={plan.used.length === 0}
              onClick={async () => {
                if (await update((s) => Object.assign(s.engine, plan.engine)))
                  setApplied(`Using ${plan.used.join(" and ")}.`);
              }}
            >
              Use recommended setup
            </button>
            {applied !== undefined && <span className="muted">{applied}</span>}
          </div>
          {configured.length > 0 && (
            <p className="muted small">
              Configured now: {configured.map((p) => `${p.label} (${p.model})`).join(", ")}. Arabic
              corrections work better with {QUALITY_MODEL}: set Fix to it under Providers if you
              mostly write Arabic.
            </p>
          )}
        </>
      )}
    </>
  );
}
