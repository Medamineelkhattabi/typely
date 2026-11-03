import { getOperation } from "@typely/correction-engine";
import { OPERATIONS, type Operation } from "@typely/schemas";
import { useCallback, useEffect, useRef, useState } from "react";
import { ResultView } from "../components/ResultView.tsx";
import { modeFor, useCorrection, useSettings } from "../correction.ts";
import {
  type CapturePayload,
  onCapture,
  onPanelHidden,
  panelCopy,
  panelHide,
  panelReady,
  panelReplace,
} from "../ipc.ts";
import { headProvider, isSmallModel } from "../local-setup.ts";
import { usableProviders } from "../settings.ts";

export const TRANSLATE_TARGETS = [
  ["en", "English"],
  ["fr", "Français"],
  ["ar", "العربية"],
  ["es", "Español"],
  ["de", "Deutsch"],
] as const;

export function Panel() {
  const { view } = useSettings();
  const settings = view?.settings;
  const { state, run, cancel, reset } = useCorrection(settings);
  const [capture, setCapture] = useState<CapturePayload>();
  const [pasted, setPasted] = useState("");
  const [operation, setOperation] = useState<Operation>("fix");
  const [target, setTarget] = useState("en");
  const [actionError, setActionError] = useState<string>();
  const handled = useRef(0);

  // A capture arrives as an event, or (if the webview loaded late) from panel_ready.
  useEffect(() => {
    const unlisten = [onCapture(setCapture), onPanelHidden(cancel)];
    panelReady()
      .then((p) => p && setCapture((c) => c ?? p))
      .catch(() => undefined);
    return () => {
      for (const u of unlisten) u.then((f) => f()).catch(() => undefined);
    };
  }, [cancel]);

  // Run the default operation as soon as a captured selection and the settings are ready.
  useEffect(() => {
    if (capture === undefined || settings === undefined || handled.current === capture.id) return;
    handled.current = capture.id;
    reset();
    setActionError(undefined);
    setPasted("");
    const op = settings.desktop.default_operation;
    setOperation(op);
    setTarget(settings.desktop.translate_target);
    if (capture.text !== undefined) void run(op, capture.text, settings.desktop.translate_target);
  }, [capture, settings, run, reset]);

  const text = capture?.text ?? pasted;
  const result = state.status === "done" ? state.result : undefined;
  const changed = state.status === "done" && state.result.corrected_text !== state.original;

  const start = useCallback(
    (op: Operation) => {
      setOperation(op);
      setActionError(undefined);
      if (text.trim() !== "") void run(op, text, target);
    },
    [run, text, target],
  );

  const replace = useCallback(async () => {
    if (result === undefined || capture === undefined) return;
    setActionError(undefined);
    try {
      await panelReplace(capture.id, result.corrected_text);
    } catch (error) {
      setActionError(String(error));
    }
  }, [capture, result]);

  const copy = useCallback(async () => {
    if (result === undefined) return;
    try {
      await panelCopy(result.corrected_text);
      await panelHide();
    } catch (error) {
      setActionError(String(error));
    }
  }, [result]);

  const close = useCallback(() => {
    cancel();
    void panelHide();
  }, [cancel]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (state.status === "running") cancel();
        else close();
      } else if (event.key === "Enter" && event.ctrlKey && changed && capture?.can_replace) {
        event.preventDefault();
        void replace();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.status, cancel, close, replace, changed, capture]);

  const usable = settings === undefined ? [] : usableProviders(settings);
  const localOnly = settings !== undefined && modeFor(settings) === "local";
  const head =
    settings === undefined ? undefined : headProvider(settings.engine, operation, usable);
  const experimental = operation !== "fix" && head !== undefined && isSmallModel(head.model);
  const password = capture?.error?.code === "password_field";

  return (
    <div className="panel">
      <header data-tauri-drag-region>
        <strong data-tauri-drag-region>Typely</strong>
        <span
          className="muted"
          data-tauri-drag-region
          title={
            capture?.method === "ui_automation"
              ? "Selection read through UI Automation"
              : capture?.method === "clipboard"
                ? "Selection read through the clipboard (restored afterwards)"
                : undefined
          }
        >
          {capture?.source_app ?? ""}
          {head !== undefined && !localOnly
            ? ` · ${head.label}`
            : localOnly
              ? " · local rules"
              : ""}
        </span>
        <button type="button" className="icon" onClick={close} aria-label="Close">
          ×
        </button>
      </header>

      <nav className="operations" aria-label="Action">
        {OPERATIONS.map((op) => (
          <button
            type="button"
            key={op}
            className={op === operation ? "chip active" : "chip"}
            disabled={password || (localOnly && op !== "fix")}
            title={localOnly && op !== "fix" ? "Needs an AI model (see settings)" : undefined}
            onClick={() => start(op)}
          >
            {getOperation(op).label}
          </button>
        ))}
        {operation === "translate" && (
          <select
            value={target}
            aria-label="Translate to"
            onChange={(e) => {
              setTarget(e.target.value);
              if (text.trim() !== "") void run("translate", text, e.target.value);
            }}
          >
            {TRANSLATE_TARGETS.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        )}
      </nav>

      <main>
        {capture?.error !== undefined && <p className="notice">{capture.error.message}</p>}
        {capture?.error !== undefined && !password && (
          <div className="paste">
            <textarea
              dir="auto"
              placeholder="Paste or type text here"
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
            />
          </div>
        )}
        {experimental && (
          <p className="muted small">
            Experimental with a small local model ({head.model}); results may be unreliable.
          </p>
        )}
        <ResultView state={state} />
      </main>

      {actionError !== undefined && (
        <p className="error action-error" role="alert">
          {actionError}
        </p>
      )}

      <footer>
        {state.status === "running" ? (
          <button type="button" onClick={cancel}>
            Cancel
          </button>
        ) : (
          <>
            {capture?.error !== undefined && !password && (
              <button
                type="button"
                disabled={pasted.trim() === ""}
                onClick={() => start(operation)}
              >
                Run
              </button>
            )}
            <span className="spacer" />
            <button type="button" disabled={result === undefined} onClick={copy}>
              Copy
            </button>
            {capture?.can_replace === true && (
              <button
                type="button"
                className="primary"
                disabled={!changed}
                title={changed ? "Ctrl+Enter" : "Nothing to replace: the text needs no changes"}
                onClick={replace}
              >
                Replace
              </button>
            )}
          </>
        )}
      </footer>
    </div>
  );
}
