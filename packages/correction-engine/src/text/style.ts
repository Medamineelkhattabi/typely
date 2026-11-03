import { diffWords } from "./diff.ts";

/**
 * Keeps the writer's apostrophe: models often turn "I'll" into "I’ll" (or back), which shows
 * up as a change the user did not need.
 */
export function keepApostrophes(base: string, revised: string): string {
  const curly = base.includes("’");
  const straight = /\p{L}'\p{L}/u.test(base);
  if (!curly && revised.includes("’")) return revised.replaceAll("’", "'");
  if (curly && !straight) return revised.replace(/(?<=\p{L})'(?=\p{L})/gu, "’");
  return revised;
}

const INFORMAL = new Set(["tu", "te", "t", "toi", "ton", "ta", "tes", "tien", "tienne"]);
const FORMAL = new Set(["vous", "votre", "vos", "vôtre"]);
const words = (text: string) => text.toLowerCase().match(/\p{L}+/gu) ?? [];

/**
 * A model change that only adds or removes spaces is put back ("9 h" → "9h"): spacing is
 * fixed by Typely's own rules, which run after the model.
 */
export function keepSpacing(base: string, revised: string): string {
  return revertStretches(
    base,
    revised,
    (removed, added) => removed.replace(/\s+/g, "") === added.replace(/\s+/g, ""),
  );
}

/**
 * A correction must not change how the reader is addressed: small models turn "tu as reçu"
 * into "vous avez reçu". Each changed stretch that swaps "tu" forms for "vous" forms (or the
 * reverse) is put back as it was.
 */
export function keepRegister(base: string, revised: string): string {
  return revertStretches(base, revised, (removed, added) => {
    const before = words(removed);
    const after = words(added);
    return (
      (before.some((w) => INFORMAL.has(w)) &&
        after.some((w) => FORMAL.has(w)) &&
        !before.some((w) => FORMAL.has(w))) ||
      (before.some((w) => FORMAL.has(w)) &&
        after.some((w) => INFORMAL.has(w)) &&
        !before.some((w) => INFORMAL.has(w)))
    );
  });
}

/** Rebuilds `revised`, putting back each changed stretch of `base` that `revert` selects. */
function revertStretches(
  base: string,
  revised: string,
  revert: (removed: string, added: string) => boolean,
): string {
  if (base === revised) return revised;
  const segments = diffWords(base, revised);
  let result = "";
  let removed = "";
  let added = "";
  const flush = () => {
    result += removed !== added && revert(removed, added) ? removed : added;
    removed = "";
    added = "";
  };
  for (const segment of segments) {
    // A space between two changed words keeps them in one stretch: "tu as" → "vous avez".
    if (segment.type === "equal" && segment.text.trim() === "" && (removed || added)) {
      removed += segment.text;
      added += segment.text;
    } else if (segment.type === "equal") {
      flush();
      result += segment.text;
    } else if (segment.type === "delete") removed += segment.text;
    else added += segment.text;
  }
  flush();
  return result;
}
