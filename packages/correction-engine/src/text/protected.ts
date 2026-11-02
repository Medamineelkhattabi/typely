export type ProtectedKind =
  | "code_block"
  | "inline_code"
  | "url"
  | "email"
  | "mention"
  | "hashtag"
  | "placeholder"
  | "domain";

export interface ProtectedSpan {
  start: number;
  end: number;
  kind: ProtectedKind;
  text: string;
}

const PATTERNS: ReadonlyArray<readonly [ProtectedKind, RegExp]> = [
  ["code_block", /```[\s\S]*?(?:```|$)/g],
  ["inline_code", /`[^`\n]+`/g],
  ["url", /(?:https?:\/\/|www\.)[^\s<>"'`]+/giu],
  ["email", /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu],
  ["placeholder", /\{\{[^{}\n]*\}\}|\$\{[^{}\n]*\}|%[sd]\b/g],
  ["mention", /(?<![\p{L}\p{N}@])@[\p{L}\p{N}_][\p{L}\p{N}_.-]*/gu],
  ["hashtag", /(?<![\p{L}\p{N}&#])#[\p{L}\p{N}_]+/gu],
  [
    "domain",
    /(?<![\p{L}\p{N}@./])[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|io|dev|fr|ma|ai|app|co|uk|de|eu|gov|edu|json|ts|tsx|js|py|md|txt|pdf|docx|xlsx|pptx|csv|exe|html|css|rs|toml|ya?ml)(?![\p{L}\p{N}])/giu,
  ],
];

const TRAILING_PUNCTUATION = /[.,;:!?)\]}»"'’]+$/u;

/**
 * Finds spans that must never be modified by local rules and must survive AI rewriting:
 * code, URLs, e-mail addresses, mentions, hashtags, template placeholders, domain and
 * file names. Returned spans are sorted and non-overlapping (earlier patterns win).
 */
export function findProtectedSpans(text: string): ProtectedSpan[] {
  const spans: ProtectedSpan[] = [];
  for (const [kind, pattern] of PATTERNS) {
    pattern.lastIndex = 0;
    for (let m = pattern.exec(text); m !== null; m = pattern.exec(text)) {
      let value = m[0];
      if (kind === "url" || kind === "domain") value = value.replace(TRAILING_PUNCTUATION, "");
      if (value.length === 0) continue;
      const start = m.index;
      const end = start + value.length;
      if (!spans.some((s) => start < s.end && end > s.start)) {
        spans.push({ start, end, kind, text: value });
      }
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}

export function overlapsAny(spans: readonly ProtectedSpan[], start: number, end: number): boolean {
  // A zero-length edit at a span boundary does not touch it; inside it does.
  return spans.some((s) =>
    start === end ? start > s.start && start < s.end : start < s.end && end > s.start,
  );
}

/** Replaces protected spans with spaces so analysis ignores them without shifting offsets. */
export function maskProtected(text: string, spans: readonly ProtectedSpan[]): string {
  let masked = "";
  let cursor = 0;
  for (const span of spans) {
    masked += text.slice(cursor, span.start) + " ".repeat(span.end - span.start);
    cursor = span.end;
  }
  return masked + text.slice(cursor);
}
