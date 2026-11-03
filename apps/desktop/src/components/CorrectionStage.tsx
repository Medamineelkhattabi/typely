import { diffWords } from "@typely/correction-engine";
import type { DiffSegment } from "@typely/schemas";
import type { CSSProperties } from "react";
import type { CorrectionState } from "../correction.ts";

type Step = "todo" | "active" | "done" | "failed";

/** Where a run stands, as the stage shows it. */
interface Stage {
  segments: readonly DiffSegment[] | undefined;
  /** Plain text for operations that rewrite rather than fix. */
  plain: string | undefined;
  scanning: boolean;
  steps: readonly [string, Step][];
  fixes: number;
  finished: "changed" | "unchanged" | undefined;
}

/** Number of separate changes: a deletion and the insertion that replaces it count once. */
export function countChanges(segments: readonly DiffSegment[]): number {
  let count = 0;
  let inChange = false;
  for (const s of segments) {
    const change = s.type !== "equal" && s.text.trim() !== "";
    if (change && !inChange) count++;
    if (s.type === "equal") inChange = false;
    else if (change) inChange = true;
  }
  return count;
}

function stageFor(state: CorrectionState, localOnly: boolean): Stage | undefined {
  if (state.status === "idle") return undefined;
  const fix = state.operation === "fix";
  const names: string[] = fix ? (localOnly ? ["Grammar"] : ["Grammar", "AI review"]) : ["AI"];
  names.push("Ready");
  const steps = (reached: number, failed = false): [string, Step][] =>
    names.map((n, i) => [
      n,
      i < reached ? "done" : i === reached ? (failed ? "failed" : "active") : "todo",
    ]);
  const plainText = { text: state.original, type: "equal" } as const;

  switch (state.status) {
    case "running": {
      if (!fix)
        return {
          segments: state.partial === undefined ? [plainText] : undefined,
          plain: state.partial,
          scanning: true,
          steps: steps(0),
          fixes: 0,
          finished: undefined,
        };
      const segments =
        state.preview === undefined ? [plainText] : diffWords(state.original, state.preview);
      return {
        segments,
        plain: undefined,
        scanning: true,
        steps: steps(state.preview === undefined ? 0 : 1),
        fixes: countChanges(segments),
        finished: undefined,
      };
    }
    case "done": {
      const { result } = state;
      const unchanged = result.corrected_text === state.original;
      return {
        segments: fix || unchanged ? (unchanged ? [plainText] : result.changes) : undefined,
        plain: fix || unchanged ? undefined : result.corrected_text,
        scanning: false,
        steps: steps(names.length),
        fixes: fix ? countChanges(result.changes) : 0,
        finished: unchanged ? "unchanged" : "changed",
      };
    }
    case "error":
      return {
        segments: [plainText],
        plain: undefined,
        scanning: false,
        // The step before "Ready" is the one that could not finish.
        steps: steps(names.length - 2, true),
        fixes: 0,
        finished: undefined,
      };
  }
}

/** Segments keyed by their place in the original, so a fix already shown is not animated again. */
function Morph({ segments }: { segments: readonly DiffSegment[] }) {
  let offset = 0;
  let change = 0;
  let inChange = false;
  return (
    <>
      {segments.map((s) => {
        const key = `${s.type}:${offset}:${s.text}`;
        if (s.type === "equal") {
          offset += s.text.length;
          inChange = false;
          return <span key={key}>{s.text}</span>;
        }
        if (!inChange) change++;
        inChange = true;
        const style = { "--d": `${(change - 1) * 110}ms` } as CSSProperties;
        if (s.type === "delete") {
          offset += s.text.length;
          return (
            <del key={key} style={style}>
              {s.text}
            </del>
          );
        }
        return (
          <ins key={key} style={style}>
            {s.text}
          </ins>
        );
      })}
    </>
  );
}

function Check() {
  return (
    <svg className="check-mark" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  );
}

/**
 * The top of the panel: the selected text, scanned while it is checked, with each fix morphing
 * in place (the wrong word is struck out and folds away, the right one rises in). Animations
 * are CSS only and stop once the result is in; reduced-motion users get the end state.
 */
export function CorrectionStage({
  state,
  localOnly,
}: {
  state: CorrectionState;
  localOnly: boolean;
}) {
  const stage = stageFor(state, localOnly);
  if (stage === undefined) return null;
  const done = state.status === "done" ? state : undefined;
  return (
    <section className="stage" aria-live="polite">
      <div
        className={[
          "stage-card",
          stage.scanning ? "scanning" : "",
          stage.finished === undefined ? "" : `finished ${stage.finished}`,
        ].join(" ")}
      >
        <p className="stage-text" dir="auto">
          {stage.segments !== undefined && <Morph segments={stage.segments} />}
          {stage.plain !== undefined && (
            <span className={stage.scanning ? "streaming" : "fade-in"}>{stage.plain}</span>
          )}
        </p>
      </div>
      <div className="stage-status">
        <ol className="steps">
          {stage.steps.map(([name, step]) => (
            <li key={name} className={`step ${step}`}>
              <span className="dot">{step === "done" && <Check />}</span>
              {name}
            </li>
          ))}
        </ol>
        {done !== undefined && (
          <span className="stage-badge" key={done.result.meta.duration_ms}>
            <Check />
            {stage.finished === "unchanged"
              ? "Looks good"
              : stage.fixes > 0
                ? `${stage.fixes} ${stage.fixes === 1 ? "fix" : "fixes"}`
                : "Done"}
            <span className="stage-time">
              {" "}
              · {(done.result.meta.duration_ms / 1000).toFixed(1)} s
            </span>
          </span>
        )}
        {state.status === "running" && stage.fixes > 0 && !localOnly && (
          <span className="stage-badge pending">{stage.fixes} found · AI reviewing…</span>
        )}
      </div>
    </section>
  );
}
