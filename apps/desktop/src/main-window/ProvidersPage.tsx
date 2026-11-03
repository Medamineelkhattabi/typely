import { CorrectionEngine, type ProviderTestResult } from "@typely/correction-engine";
import { createAdapter } from "@typely/provider-adapters";
import {
  OPERATIONS,
  type Operation,
  type ProviderConfig,
  ProviderConfigSchema,
  type ProviderKind,
} from "@typely/schemas";
import { useCallback, useEffect, useState } from "react";
import { describeError } from "../errors.ts";
import {
  createTransport,
  deleteSecret,
  type SecretState,
  secretStatus,
  setSecret,
} from "../ipc.ts";
import { type AppSettings, isCloudProvider } from "../settings.ts";
import type { UpdateSettings } from "./App.tsx";

const KINDS: { kind: ProviderKind; label: string; model: string }[] = [
  { kind: "anthropic", label: "Anthropic", model: "" },
  { kind: "openai", label: "OpenAI", model: "" },
  { kind: "gemini", label: "Google Gemini", model: "" },
  { kind: "openai_compatible", label: "OpenAI-compatible server", model: "" },
  { kind: "ollama", label: "Ollama", model: "gemma3:1b" },
];

const transport = createTransport();

function host(provider: ProviderConfig): string {
  try {
    return new URL(createAdapter(provider).baseUrl).host;
  } catch {
    return "?";
  }
}

function uniqueId(base: string, taken: readonly ProviderConfig[]): string {
  const clean = base.replace(/[^a-z0-9_-]/g, "-").replace(/^-+/, "") || "provider";
  let id = clean;
  for (let n = 2; taken.some((p) => p.id === id); n++) id = `${clean}-${n}`;
  return id;
}

export function ProvidersPage({
  settings,
  update,
}: {
  settings: AppSettings;
  update: UpdateSettings;
}) {
  const [secrets, setSecrets] = useState<Record<string, SecretState>>({});
  const refreshSecrets = useCallback(() => {
    secretStatus()
      .then(setSecrets)
      .catch(() => undefined);
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh when providers change
  useEffect(refreshSecrets, [settings.engine.providers]);
  const { providers } = settings.engine;

  return (
    <>
      <h2>Providers</h2>
      <p className="muted">
        API keys are stored in the Windows Credential Manager and only ever sent to the host they
        were entered for. Typely's windows can store a key but never read it back.
      </p>
      {!settings.engine.privacy.cloud_processing_allowed && (
        <p className="notice">
          Cloud processing is off (Privacy), so cloud providers are not used even when approved.
        </p>
      )}
      {providers.length === 0 && <p>No provider yet. Set up Local AI, or add one below.</p>}
      {providers.map((p) => (
        <ProviderCard
          key={p.id}
          provider={p}
          settings={settings}
          update={update}
          secret={secrets[p.id]}
          onSecretChanged={refreshSecrets}
        />
      ))}
      <Routing settings={settings} update={update} />
      <AddProvider settings={settings} update={update} />
    </>
  );
}

function ProviderCard({
  provider,
  settings,
  update,
  secret,
  onSecretChanged,
}: {
  provider: ProviderConfig;
  settings: AppSettings;
  update: UpdateSettings;
  secret: SecretState | undefined;
  onSecretChanged: () => void;
}) {
  const cloud = isCloudProvider(provider);
  const [key, setKey] = useState("");
  const [message, setMessage] = useState<string>();
  const [test, setTest] = useState<ProviderTestResult | "running">();
  const edit = (change: (p: ProviderConfig) => void) =>
    update((s) => {
      const target = s.engine.providers.find((x) => x.id === provider.id);
      if (target !== undefined) change(target);
    });

  return (
    <div className="card">
      <div className="row">
        <strong>{provider.label}</strong>
        <span className={cloud ? "badge cloud" : "badge local"}>{cloud ? "cloud" : "local"}</span>
        <span className="muted">
          {provider.model} · {host(provider)}
        </span>
        <span className="spacer" />
        <label className="check inline">
          <input
            type="checkbox"
            checked={provider.enabled}
            onChange={(e) =>
              edit((p) => {
                p.enabled = e.target.checked;
              })
            }
          />
          Enabled
        </label>
      </div>
      {cloud && (
        <label className="check">
          <input
            type="checkbox"
            checked={provider.consent_granted}
            onChange={(e) =>
              edit((p) => {
                p.consent_granted = e.target.checked;
              })
            }
          />
          <span>
            I agree that text I correct may be sent to <strong>{host(provider)}</strong> for
            processing under that provider's terms.
          </span>
        </label>
      )}
      {cloud && provider.consent_granted && !settings.engine.privacy.cloud_processing_allowed && (
        <p className="muted small">Not used until cloud processing is allowed under Privacy.</p>
      )}
      {secret !== undefined && (
        <div className="row">
          <span className="muted">
            API key:{" "}
            {secret === "stored"
              ? "stored"
              : secret === "origin_changed"
                ? "saved for another address, enter it again"
                : "none"}
          </span>
          <input
            type="password"
            autoComplete="off"
            placeholder="Paste a key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <button
            type="button"
            disabled={key.trim() === ""}
            onClick={async () => {
              try {
                await setSecret(provider.id, key);
                setKey("");
                setMessage("Key saved.");
              } catch (error) {
                setMessage(describeError(error));
              }
              onSecretChanged();
            }}
          >
            Save key
          </button>
          {secret !== "missing" && (
            <button
              type="button"
              onClick={async () => {
                await deleteSecret(provider.id).catch(() => undefined);
                onSecretChanged();
              }}
            >
              Remove key
            </button>
          )}
        </div>
      )}
      <div className="row">
        <button
          type="button"
          disabled={test === "running"}
          onClick={async () => {
            setTest("running");
            const engine = new CorrectionEngine({ settings: settings.engine, transport });
            setTest(await engine.testProvider(provider.id));
          }}
        >
          Test connection
        </button>
        <button
          type="button"
          onClick={() =>
            update((s) => {
              s.engine.providers = s.engine.providers.filter((x) => x.id !== provider.id);
              s.engine.provider_order = s.engine.provider_order.filter((id) => id !== provider.id);
              for (const op of OPERATIONS)
                if (s.engine.operation_providers[op] === provider.id)
                  delete s.engine.operation_providers[op];
            }).then(() => deleteSecret(provider.id).catch(() => undefined))
          }
        >
          Remove
        </button>
        {test === "running" && (
          <span className="muted">Testing… (lists models; sends no text)</span>
        )}
        {test !== undefined && test !== "running" && (
          <span className={test.ok ? "ok" : "error-text"}>
            {test.ok
              ? `Connected. ${test.models.length} model(s)${test.models.includes(provider.model) ? `, including ${provider.model}` : `; ${provider.model} not found`}.`
              : `${test.errorKind}: ${test.message}`}
          </span>
        )}
      </div>
      {message !== undefined && <p className="muted small">{message}</p>}
    </div>
  );
}

function Routing({ settings, update }: { settings: AppSettings; update: UpdateSettings }) {
  const { providers, operation_providers } = settings.engine;
  if (providers.length < 2) return null;
  return (
    <details className="card">
      <summary>Which provider handles each action</summary>
      <p className="muted small">
        Other providers are tried in order if the first one fails. Default:{" "}
        {(settings.engine.provider_order.length > 0
          ? settings.engine.provider_order
          : providers.map((p) => p.id)
        ).join(" → ")}
        .
      </p>
      {OPERATIONS.map((op: Operation) => (
        <label key={op} className="field inline">
          <span>{op}</span>
          <select
            value={operation_providers[op] ?? ""}
            onChange={(e) =>
              update((s) => {
                if (e.target.value === "") delete s.engine.operation_providers[op];
                else s.engine.operation_providers[op] = e.target.value;
              })
            }
          >
            <option value="">Default order</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      ))}
    </details>
  );
}

function AddProvider({ settings, update }: { settings: AppSettings; update: UpdateSettings }) {
  const [kind, setKind] = useState<ProviderKind>("anthropic");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [key, setKey] = useState("");
  const [error, setError] = useState<string>();
  const preset = KINDS.find((k) => k.kind === kind) ?? KINDS[0];

  const add = async () => {
    setError(undefined);
    const parsed = ProviderConfigSchema.safeParse({
      id: uniqueId(kind.replace("_", "-"), settings.engine.providers),
      kind,
      label: preset?.label ?? kind,
      model: model.trim(),
      ...(baseUrl.trim() === "" ? {} : { base_url: baseUrl.trim() }),
    });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
      return;
    }
    const provider = parsed.data;
    const ok = await update((s) => {
      s.engine.providers.push(provider);
      if (s.engine.provider_order.length > 0) s.engine.provider_order.push(provider.id);
    });
    if (!ok) return;
    if (key.trim() !== "") {
      try {
        await setSecret(provider.id, key);
      } catch (e) {
        setError(describeError(e));
      }
    }
    setKey("");
  };

  return (
    <div className="card">
      <h3>Add a provider</h3>
      <label className="field inline">
        <span>Type</span>
        <select
          value={kind}
          onChange={(e) => {
            const next = e.target.value as ProviderKind;
            setKind(next);
            setModel(KINDS.find((k) => k.kind === next)?.model ?? "");
          }}
        >
          {KINDS.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field inline">
        <span>Model</span>
        <input value={model} onChange={(e) => setModel(e.target.value)} />
      </label>
      <label className="field inline">
        <span>Base URL</span>
        <input
          value={baseUrl}
          placeholder={
            kind === "openai_compatible" ? "required, e.g. http://localhost:1234/v1" : "default"
          }
          onChange={(e) => setBaseUrl(e.target.value)}
        />
      </label>
      {kind !== "ollama" && (
        <label className="field inline">
          <span>API key</span>
          <input
            type="password"
            autoComplete="off"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
        </label>
      )}
      <p className="muted small">
        New cloud providers start without consent: approve each one in its card before it is used.
      </p>
      <button type="button" className="primary" disabled={model.trim() === ""} onClick={add}>
        Add
      </button>
      {error !== undefined && <p className="error">{error}</p>}
    </div>
  );
}
