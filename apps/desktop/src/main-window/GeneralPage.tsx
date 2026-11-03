import { getOperation } from "@typely/correction-engine";
import { CORRECTION_MODES, type CorrectionMode, OPERATIONS, type Operation } from "@typely/schemas";
import { useState } from "react";
import { modeFor } from "../correction.ts";
import { TRANSLATE_TARGETS } from "../panel/Panel.tsx";
import {
  type AppSettings,
  DEFAULT_SHORTCUT,
  isCloudProvider,
  NEEDS_AI_HINT,
  runnableOperation,
} from "../settings.ts";
import type { UpdateSettings } from "./App.tsx";

interface PageProps {
  settings: AppSettings;
  update: UpdateSettings;
}

export function GeneralPage({ settings, update }: PageProps) {
  const [shortcut, setShortcut] = useState(settings.desktop.shortcut);
  const localOnly = modeFor(settings) === "local";
  return (
    <>
      <h2>General</h2>
      <label className="field">
        <span>Shortcut</span>
        <div className="row">
          <input value={shortcut} onChange={(e) => setShortcut(e.target.value)} />
          <button
            type="button"
            disabled={shortcut.trim() === settings.desktop.shortcut}
            onClick={() =>
              update((s) => {
                s.desktop.shortcut = shortcut.trim();
              })
            }
          >
            Apply
          </button>
          <button type="button" onClick={() => setShortcut(DEFAULT_SHORTCUT)}>
            Default
          </button>
        </div>
        <small className="muted">
          For example Ctrl+Shift+Space or Alt+K. It must include Ctrl, Alt or Win. If another app
          already uses it, the previous shortcut stays active.
        </small>
      </label>
      <label className="field">
        <span>When the panel opens</span>
        <select
          value={runnableOperation(settings.desktop.default_operation, localOnly)}
          onChange={(e) =>
            update((s) => {
              s.desktop.default_operation = e.target.value as Operation;
            })
          }
        >
          {OPERATIONS.map((op) => (
            <option
              key={op}
              value={op}
              disabled={localOnly && op !== "fix"}
              title={localOnly && op !== "fix" ? NEEDS_AI_HINT : undefined}
            >
              {getOperation(op).label}
            </option>
          ))}
        </select>
        {localOnly && (
          <small className="muted">
            Without an AI model the panel always corrects. Set up Local AI or add a provider to
            choose another action.
          </small>
        )}
      </label>
      <label className="field">
        <span>Translate to</span>
        <select
          value={settings.desktop.translate_target}
          onChange={(e) =>
            update((s) => {
              s.desktop.translate_target = e.target.value;
            })
          }
        >
          {TRANSLATE_TARGETS.map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <p className="muted small">
        Closing this window keeps Typely running in the tray so the shortcut works. Quit from the
        tray icon.
      </p>
    </>
  );
}

const MODE_TEXT: Record<CorrectionMode, string> = {
  hybrid: "Local rules first, then the AI model (recommended)",
  ai: "AI model only",
  local: "Local rules only: nothing is sent to any model",
};

export function PrivacyPage({ settings, update }: PageProps) {
  const { privacy } = settings.engine;
  const cloud = settings.engine.providers.filter(isCloudProvider);
  return (
    <>
      <h2>Privacy</h2>
      <p>
        By default Typely works on this computer only: local rules, and a local model if you set one
        up. Text is never stored, and there is no telemetry.
      </p>
      <label className="check">
        <input
          type="checkbox"
          checked={privacy.cloud_processing_allowed}
          onChange={(e) =>
            update((s) => {
              s.engine.privacy.cloud_processing_allowed = e.target.checked;
            })
          }
        />
        <span>
          <strong>Allow cloud processing.</strong> When on, text you send to Typely may go to the
          cloud providers you have also individually approved under Providers. Only the selected
          text is sent.
        </span>
      </label>
      {privacy.cloud_processing_allowed && cloud.length > 0 && (
        <ul className="muted small">
          {cloud.map((p) => (
            <li key={p.id}>
              {p.label}: {p.consent_granted ? "approved" : "not approved"}
              {p.enabled ? "" : " (disabled)"}
            </li>
          ))}
        </ul>
      )}
      <label className="field">
        <span>Correction mode</span>
        <select
          value={settings.engine.default_mode}
          onChange={(e) =>
            update((s) => {
              s.engine.default_mode = e.target.value as CorrectionMode;
            })
          }
        >
          {CORRECTION_MODES.map((m) => (
            <option key={m} value={m}>
              {MODE_TEXT[m]}
            </option>
          ))}
        </select>
      </label>
      <p className="muted small">
        Password fields are never read. Typely reads the selection through UI Automation, or by
        copying it when an app does not support that; your clipboard is restored right after.
      </p>
    </>
  );
}
