import { CorrectionEngine } from "@typely/correction-engine";
import type { CorrectionResult, Operation } from "@typely/schemas";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { describeError, isCancellation } from "./errors.ts";
import {
  createTransport,
  getSettings,
  onSettingsChanged,
  type SettingsView,
  spellCheck,
} from "./ipc.ts";
import { type AppSettings, usableProviders } from "./settings.ts";
import { createSpeller } from "./spelling.ts";

export type CorrectionState =
  | { status: "idle" }
  | {
      status: "running";
      operation: Operation;
      original: string;
      /** Deterministic local result, shown at once (hybrid `fix`). */
      preview?: string;
      /** Model text streamed so far. */
      partial?: string;
      providerId?: string;
    }
  | { status: "done"; operation: Operation; original: string; result: CorrectionResult }
  | { status: "error"; operation: Operation; original: string; message: string };

/** Settings from Rust, kept current when another window saves them. */
export function useSettings(): {
  view: SettingsView | undefined;
  setView: (view: SettingsView) => void;
} {
  const [view, setView] = useState<SettingsView>();
  useEffect(() => {
    let active = true;
    getSettings()
      .then((v) => active && setView(v))
      .catch((e: unknown) => console.error("settings_get failed", e));
    const unlisten = onSettingsChanged((settings) => {
      if (active) setView((v) => ({ ...v, settings }));
    });
    return () => {
      active = false;
      unlisten.then((u) => u()).catch(() => undefined);
    };
  }, []);
  return { view, setView };
}

const transport = createTransport();
/** The word list is decoded on the first correction, not when the window loads. */
const speller = createSpeller(spellCheck);

/** Mode for a run: without a usable provider only the local rules can answer. */
export function modeFor(settings: AppSettings) {
  return usableProviders(settings).length === 0 ? "local" : settings.engine.default_mode;
}

/** Runs the engine with live local preview and streaming, one request at a time. */
export function useCorrection(settings: AppSettings | undefined) {
  const engine = useMemo(
    () =>
      settings === undefined
        ? undefined
        : new CorrectionEngine({ settings: settings.engine, transport, speller }),
    [settings],
  );
  const [state, setState] = useState<CorrectionState>({ status: "idle" });
  const controller = useRef<AbortController | undefined>(undefined);
  const runId = useRef(0);

  const cancel = useCallback(() => {
    controller.current?.abort();
    controller.current = undefined;
  }, []);

  const run = useCallback(
    async (operation: Operation, text: string, targetLanguage?: string) => {
      if (engine === undefined || settings === undefined) return;
      cancel();
      const abort = new AbortController();
      controller.current = abort;
      const id = ++runId.current;
      const current = () => runId.current === id;
      setState({ status: "running", operation, original: text });
      try {
        const result = await engine.run(
          {
            operation,
            text,
            mode: modeFor(settings),
            ...(operation === "translate" && targetLanguage !== undefined
              ? { target_language: targetLanguage }
              : {}),
          },
          {
            signal: abort.signal,
            onLocalPreview: (preview) => {
              if (current())
                setState((s) =>
                  s.status === "running" ? { ...s, preview: preview.corrected_text } : s,
                );
            },
            onPartialText: (partial, providerId) => {
              if (current())
                setState((s) => (s.status === "running" ? { ...s, partial, providerId } : s));
            },
          },
        );
        if (current()) setState({ status: "done", operation, original: text, result });
      } catch (error) {
        if (!current()) return;
        if (isCancellation(error)) setState({ status: "idle" });
        else
          setState({ status: "error", operation, original: text, message: describeError(error) });
      } finally {
        if (controller.current === abort) controller.current = undefined;
      }
    },
    [engine, settings, cancel],
  );

  const reset = useCallback(() => {
    cancel();
    runId.current++;
    setState({ status: "idle" });
  }, [cancel]);

  useEffect(() => cancel, [cancel]);

  return { state, run, cancel, reset };
}
