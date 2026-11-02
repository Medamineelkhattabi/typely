import type { DiffSegment } from "@typely/schemas";

const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "word" })
    : undefined;

/** Splits text into words, whitespace runs and punctuation (Unicode-aware, works for Arabic). */
export function tokenize(text: string): string[] {
  if (segmenter !== undefined) return Array.from(segmenter.segment(text), (s) => s.segment);
  return text.match(/\s+|[\p{L}\p{M}\p{N}]+|[^\s\p{L}\p{M}\p{N}]/gu) ?? [];
}

/** Above this many edits a token diff is not useful for highlighting; fall back to replace-all. */
const MAX_EDIT_DISTANCE = 4000;

/**
 * Word-level diff using Myers' O((N+M)·D) algorithm. Only the diagonals reachable at each
 * step are stored, so memory is O(D²) rather than O(D·(N+M)).
 */
export function diffWords(original: string, revised: string): DiffSegment[] {
  if (original === revised) return original === "" ? [] : [{ type: "equal", text: original }];
  const a = tokenize(original);
  const b = tokenize(revised);
  const edits = myers(a, b);
  if (edits === undefined) {
    return [
      ...(original === "" ? [] : [{ type: "delete" as const, text: original }]),
      ...(revised === "" ? [] : [{ type: "insert" as const, text: revised }]),
    ];
  }
  return merge(edits);
}

type Edit = { type: DiffSegment["type"]; text: string };

function myers(a: readonly string[], b: readonly string[]): Edit[] | undefined {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const limit = Math.min(max, MAX_EDIT_DISTANCE);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];

  for (let d = 0; d <= limit; d++) {
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0));
      let x = down ? (v[offset + k + 1] ?? 0) : (v[offset + k - 1] ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        trace.push(v.slice(offset - d, offset + d + 1));
        return backtrack(a, b, trace);
      }
    }
    trace.push(v.slice(offset - d, offset + d + 1));
  }
  return undefined;
}

function backtrack(
  a: readonly string[],
  b: readonly string[],
  trace: readonly Int32Array[],
): Edit[] {
  const edits: Edit[] = [];
  let x = a.length;
  let y = b.length;
  for (let d = trace.length - 1; d > 0; d--) {
    const previous = trace[d - 1] ?? new Int32Array();
    const at = (k: number) => previous[k + d - 1] ?? 0;
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const prevK = down ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      edits.push({ type: "equal", text: a[--x] ?? "" });
      y--;
    }
    if (down) edits.push({ type: "insert", text: b[--y] ?? "" });
    else edits.push({ type: "delete", text: a[--x] ?? "" });
  }
  while (x > 0 && y > 0) {
    edits.push({ type: "equal", text: a[--x] ?? "" });
    y--;
  }
  return edits.reverse();
}

function merge(edits: readonly Edit[]): DiffSegment[] {
  const segments: DiffSegment[] = [];
  // Group delete/insert runs so a replacement reads as "delete X, insert Y".
  let pendingDelete = "";
  let pendingInsert = "";
  const flush = () => {
    if (pendingDelete) segments.push({ type: "delete", text: pendingDelete });
    if (pendingInsert) segments.push({ type: "insert", text: pendingInsert });
    pendingDelete = "";
    pendingInsert = "";
  };
  for (const edit of edits) {
    if (edit.type === "delete") pendingDelete += edit.text;
    else if (edit.type === "insert") pendingInsert += edit.text;
    else {
      flush();
      const last = segments.at(-1);
      if (last?.type === "equal") last.text += edit.text;
      else segments.push({ type: "equal", text: edit.text });
    }
  }
  flush();
  return segments;
}

/** Share of the original text that was deleted or replaced (0 = untouched, 1 = rewritten). */
export function changeRatio(original: string, segments: readonly DiffSegment[]): number {
  if (original.length === 0) return segments.some((s) => s.type === "insert") ? 1 : 0;
  const deleted = segments
    .filter((s) => s.type === "delete")
    .reduce((sum, s) => sum + s.text.length, 0);
  const inserted = segments
    .filter((s) => s.type === "insert")
    .reduce((sum, s) => sum + s.text.length, 0);
  return Math.min(1, Math.max(deleted, inserted) / original.length);
}
