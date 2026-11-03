import type { CorrectionResult, DiffSegment, ResultWarning } from "@typely/schemas";
import type { CorrectionState } from "../correction.ts";

const WARNING_TEXT: Partial<Record<ResultWarning["code"], string>> = {
  ai_rejected:
    "The AI answer did not look like a correction of your text, so it was discarded. Only the local fixes are shown.",
  language_changed: "The suggestion is in a different language than your text.",
  protected_token_lost: "The suggestion dropped a link, code, number or name from your text.",
  excessive_changes: "The suggestion changes much more than a correction should. Review it.",
};

/** Warnings that must be read before Replace. */
const SERIOUS = new Set<ResultWarning["code"]>([
  "ai_rejected",
  "language_changed",
  "protected_token_lost",
  "excessive_changes",
]);

export function Diff({ segments }: { segments: readonly DiffSegment[] }) {
  return (
    <p className="text diff" dir="auto">
      {segments.map((s, i) =>
        s.type === "equal" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional
          <span key={i}>{s.text}</span>
        ) : s.type === "insert" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional
          <ins key={i}>{s.text}</ins>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional
          <del key={i}>{s.text}</del>
        ),
      )}
    </p>
  );
}

export function Warnings({ warnings }: { warnings: readonly ResultWarning[] }) {
  const shown = warnings.filter((w) => w.code !== "no_changes");
  if (shown.length === 0) return null;
  return (
    <ul className="warnings">
      {shown.map((w) => (
        <li key={w.code + w.message} className={SERIOUS.has(w.code) ? "serious" : ""}>
          {WARNING_TEXT[w.code] ?? w.message.replace(/^LanguageTool unavailable: /, "")}
        </li>
      ))}
    </ul>
  );
}

/** Picks one candidate for a suggestion; without it the suggestions are only listed. */
export type OnChoose = (index: number, replacement: string) => void;

function Suggestions({ result, onChoose }: { result: CorrectionResult; onChoose?: OnChoose }) {
  const suggestions = result.suggestions ?? [];
  if (suggestions.length === 0) return null;
  return (
    <div className="suggestions">
      <p className="label">To check</p>
      <ul>
        {suggestions.map((s, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: suggestions have no identity
          <li key={i} dir="auto">
            <del>{s.original}</del> →{" "}
            {s.replacements.map((r) =>
              onChoose === undefined ? (
                <ins key={r}>{r}</ins>
              ) : (
                <button type="button" key={r} className="chip" onClick={() => onChoose(i, r)}>
                  {r}
                </button>
              ),
            )}
            <span className="reason"> {s.reason}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Result({
  result,
  original,
  onChoose,
}: {
  result: CorrectionResult;
  original: string;
  onChoose?: OnChoose;
}) {
  const unchanged = result.corrected_text === original;
  return (
    <>
      {unchanged ? (
        <p className="muted">No changes needed.</p>
      ) : result.operation === "fix" ? (
        <Diff segments={result.changes} />
      ) : (
        <p className="text" dir="auto">
          {result.corrected_text}
        </p>
      )}
      <Warnings warnings={result.warnings} />
      {result.explanation.length > 0 && (
        <ul className="explanations">
          {result.explanation.slice(0, 8).map((e, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: items have no identity
            <li key={i} dir="auto">
              {e.original && <del>{e.original}</del>}
              {e.original && e.corrected && " → "}
              {e.corrected && <ins>{e.corrected}</ins>}
              <span className="reason"> {e.reason}</span>
            </li>
          ))}
        </ul>
      )}
      <Suggestions result={result} {...(onChoose === undefined ? {} : { onChoose })} />
      <p className="meta">
        {result.meta.model ?? "local rules"} · {result.detected_language} ·{" "}
        {(result.meta.duration_ms / 1000).toFixed(1)} s
      </p>
    </>
  );
}

export function ResultView({ state, onChoose }: { state: CorrectionState; onChoose?: OnChoose }) {
  switch (state.status) {
    case "idle":
      return null;
    case "running":
      return (
        <div className="running" aria-live="polite">
          {state.preview !== undefined && state.partial === undefined && (
            <>
              <p className="label">Instant local fixes</p>
              <p className="text" dir="auto">
                {state.preview}
              </p>
            </>
          )}
          <p className="label">
            <span className="spinner" aria-hidden="true" />
            {state.partial === undefined ? "Waiting for the model…" : "Writing…"}
          </p>
          {state.partial !== undefined && (
            <p className="text streaming" dir="auto">
              {state.partial}
            </p>
          )}
        </div>
      );
    case "done":
      return (
        <Result
          result={state.result}
          original={state.original}
          {...(onChoose === undefined ? {} : { onChoose })}
        />
      );
    case "error":
      return <p className="error">{state.message}</p>;
  }
}

/** Whether the result can be pasted back as is (warnings are shown, not blocking). */
export function hasSeriousWarning(result: CorrectionResult): boolean {
  return result.warnings.some((w) => SERIOUS.has(w.code));
}
