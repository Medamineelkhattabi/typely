import { useCallback, useState } from "react";
import { useSettings } from "../correction.ts";
import { describeError } from "../errors.ts";
import { saveSettings } from "../ipc.ts";
import type { AppSettings } from "../settings.ts";
import { AssistantPage } from "./AssistantPage.tsx";
import { GeneralPage, PrivacyPage } from "./GeneralPage.tsx";
import { LocalAiPage } from "./LocalAiPage.tsx";
import { ProvidersPage } from "./ProvidersPage.tsx";

const PAGES = [
  ["assistant", "Assistant"],
  ["local", "Local AI"],
  ["providers", "Providers"],
  ["privacy", "Privacy"],
  ["general", "General"],
] as const;
type Page = (typeof PAGES)[number][0];

/** Applies `change` to a copy of the settings and saves it through Rust (validated twice). */
export type UpdateSettings = (change: (draft: AppSettings) => void) => Promise<boolean>;

export function App() {
  const { view, setView } = useSettings();
  const [page, setPage] = useState<Page>("assistant");
  const [saveError, setSaveError] = useState<string>();

  const update: UpdateSettings = useCallback(
    async (change) => {
      if (view === undefined) return false;
      const draft = structuredClone(view.settings);
      change(draft);
      try {
        const saved = await saveSettings(draft);
        // A successful save also re-registered the shortcut.
        setView(
          view.warning === undefined
            ? { settings: saved }
            : { settings: saved, warning: view.warning },
        );
        setSaveError(undefined);
        return true;
      } catch (error) {
        setSaveError(describeError(error));
        return false;
      }
    },
    [view, setView],
  );

  if (view === undefined) return <p className="loading">Loading…</p>;
  const { settings } = view;

  return (
    <div className="app">
      <aside>
        <h1>Typely</h1>
        <nav>
          {PAGES.map(([id, label]) => (
            <button
              type="button"
              key={id}
              className={id === page ? "active" : ""}
              onClick={() => setPage(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <p className="muted small">
          Select text anywhere and press <kbd>{settings.desktop.shortcut}</kbd>.
        </p>
      </aside>
      <section className="content">
        {view.warning !== undefined && <p className="notice">{view.warning}</p>}
        {view.shortcut_error !== undefined && <p className="error">{view.shortcut_error}</p>}
        {saveError !== undefined && <p className="error">{saveError}</p>}
        {page === "assistant" && <AssistantPage settings={settings} />}
        {page === "local" && <LocalAiPage settings={settings} update={update} />}
        {page === "providers" && <ProvidersPage settings={settings} update={update} />}
        {page === "privacy" && <PrivacyPage settings={settings} update={update} />}
        {page === "general" && <GeneralPage settings={settings} update={update} />}
      </section>
    </div>
  );
}
