import { getOperation } from "@typely/correction-engine";
import { OPERATIONS, type Operation } from "@typely/schemas";
import { useState } from "react";
import { ResultView } from "../components/ResultView.tsx";
import { modeFor, useCorrection } from "../correction.ts";
import { panelCopy } from "../ipc.ts";
import { TRANSLATE_TARGETS } from "../panel/Panel.tsx";
import {
  type AppSettings,
  NEEDS_AI_HINT,
  runnableOperation,
  usableProviders,
} from "../settings.ts";

/** Try the engine without the shortcut. Text typed here is not stored. */
export function AssistantPage({ settings }: { settings: AppSettings }) {
  const { state, run, cancel, choose } = useCorrection(settings);
  const [text, setText] = useState("");
  const [chosen, setOperation] = useState<Operation>(settings.desktop.default_operation);
  const [target, setTarget] = useState(settings.desktop.translate_target);
  const localOnly = modeFor(settings) === "local";
  const operation = runnableOperation(chosen, localOnly);
  const providers = usableProviders(settings);

  return (
    <>
      <h2>Assistant</h2>
      <p className="muted">
        {localOnly
          ? "No AI model is set up: corrections use Typely's local rules only. Set up Local AI for more."
          : `Using ${providers.map((p) => p.label).join(", ")}.`}
      </p>
      <textarea
        className="editor"
        dir="auto"
        value={text}
        placeholder="Type or paste text to correct"
        onChange={(e) => setText(e.target.value)}
      />
      <div className="row">
        <select
          value={operation}
          aria-label="Action"
          onChange={(e) => setOperation(e.target.value as Operation)}
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
        {operation === "translate" && (
          <select
            value={target}
            aria-label="Translate to"
            onChange={(e) => setTarget(e.target.value)}
          >
            {TRANSLATE_TARGETS.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        )}
        {state.status === "running" ? (
          <button type="button" onClick={cancel}>
            Cancel
          </button>
        ) : (
          <button
            type="button"
            className="primary"
            disabled={text.trim() === ""}
            onClick={() => run(operation, text, target)}
          >
            Run
          </button>
        )}
        {state.status === "done" && (
          <button type="button" onClick={() => panelCopy(state.result.corrected_text)}>
            Copy result
          </button>
        )}
      </div>
      {localOnly && (
        <p className="muted small">
          Only Correct works with local rules. Rewrite, Translate and the other actions need an AI
          model: set up Local AI or add a provider.
        </p>
      )}
      <div className="result">
        <ResultView state={state} onChoose={choose} />
      </div>
    </>
  );
}
