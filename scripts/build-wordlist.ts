/**
 * Builds packages/correction-engine/data/en-words.txt from SCOWL's Hunspell dictionaries
 * (https://github.com/en-wl/wordlist/releases, "hunspell-en_US" and "hunspell-en_GB-ise").
 *
 *   node scripts/build-wordlist.ts <unzipped en_US dir> <unzipped en_GB-ise dir>
 *
 * Every affix rule is expanded, so the engine needs no Hunspell implementation. US and
 * British spellings are merged: "colour" must not look like a typo of "color".
 *
 * Output format (front-coded to stay small): one word per line, sorted, written as
 * `<digits><suffix>` where the digits give how many leading characters are shared with the
 * previous word. A leading "!" marks words that are valid but never suggested (taboo words).
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface Affix {
  strip: string;
  add: string;
  condition: RegExp;
}
interface AffixGroup {
  kind: "PFX" | "SFX";
  cross: boolean;
  rules: Affix[];
}

function parseAff(text: string): {
  groups: Map<string, AffixGroup>;
  flags: Record<string, string>;
} {
  const groups = new Map<string, AffixGroup>();
  const flags: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const parts = line.split(/\s+/);
    const [kind, flag, a, b, c] = parts;
    if ((kind === "NOSUGGEST" || kind === "ONLYINCOMPOUND") && flag !== undefined)
      flags[kind] = flag;
    if ((kind !== "PFX" && kind !== "SFX") || flag === undefined || a === undefined) continue;
    const group = groups.get(flag);
    if (group === undefined) {
      groups.set(flag, { kind, cross: a === "Y", rules: [] });
      continue;
    }
    if (b === undefined) continue;
    const strip = a === "0" ? "" : a;
    const add = (b === "0" ? "" : b).split("/")[0] ?? "";
    const cond = c === undefined || c === "." ? "" : c;
    group.rules.push({
      strip,
      add,
      condition: new RegExp(kind === "SFX" ? `${cond}$` : `^${cond}`, "u"),
    });
  }
  return { groups, flags };
}

function applyAffix(word: string, group: AffixGroup, rule: Affix): string | undefined {
  if (!rule.condition.test(word)) return undefined;
  if (group.kind === "SFX") {
    if (!word.endsWith(rule.strip)) return undefined;
    return word.slice(0, word.length - rule.strip.length) + rule.add;
  }
  if (!word.startsWith(rule.strip)) return undefined;
  return rule.add + word.slice(rule.strip.length);
}

function expand(dir: string, valid: Set<string>, noSuggest: Set<string>): void {
  const files = readdirSync(dir);
  const aff = files.find((f) => f.endsWith(".aff"));
  const dic = files.find((f) => f.endsWith(".dic"));
  if (aff === undefined || dic === undefined) throw new Error(`No .aff/.dic in ${dir}`);
  const { groups, flags } = parseAff(readFileSync(join(dir, aff), "utf8"));
  const lines = readFileSync(join(dir, dic), "utf8").split(/\r?\n/).slice(1);
  for (const line of lines) {
    if (line.trim() === "") continue;
    const [word = "", flagText = ""] = line.split("/");
    const wordFlags = [...flagText];
    if (/\d/.test(word) || wordFlags.includes(flags["ONLYINCOMPOUND"] ?? "\0")) continue;
    const target = wordFlags.includes(flags["NOSUGGEST"] ?? "\0") ? noSuggest : valid;
    const forms = new Set([word]);
    const prefixed: Array<{ form: string; cross: boolean }> = [];
    for (const flag of wordFlags) {
      const group = groups.get(flag);
      if (group?.kind !== "PFX") continue;
      for (const rule of group.rules) {
        const form = applyAffix(word, group, rule);
        if (form !== undefined) {
          forms.add(form);
          prefixed.push({ form, cross: group.cross });
        }
      }
    }
    for (const flag of wordFlags) {
      const group = groups.get(flag);
      if (group?.kind !== "SFX") continue;
      for (const rule of group.rules) {
        const form = applyAffix(word, group, rule);
        if (form !== undefined) forms.add(form);
        if (!group.cross) continue;
        for (const p of prefixed.filter((x) => x.cross)) {
          const both = applyAffix(p.form, group, rule);
          if (both !== undefined) forms.add(both);
        }
      }
    }
    for (const form of forms) target.add(form);
  }
}

const [usDir, gbDir] = process.argv.slice(2);
if (usDir === undefined || gbDir === undefined) {
  process.stderr.write("Usage: node scripts/build-wordlist.ts <en_US dir> <en_GB-ise dir>\n");
  process.exit(1);
}
const valid = new Set<string>();
const noSuggest = new Set<string>();
expand(usDir, valid, noSuggest);
expand(gbDir, valid, noSuggest);
for (const word of valid) noSuggest.delete(word);

const entries = [
  ...[...valid].map((w) => ({ w, mark: "" })),
  ...[...noSuggest].map((w) => ({ w, mark: "!" })),
]
  // Curly apostrophes are normalised to ASCII by the speller.
  .map((e) => ({ ...e, w: e.w.replaceAll("’", "'") }))
  .sort((a, b) => (a.w < b.w ? -1 : a.w > b.w ? 1 : 0));
let previous = "";
const out: string[] = [];
for (const { w, mark } of entries) {
  if (w === previous) continue;
  let shared = 0;
  while (
    shared < 9 &&
    shared < w.length &&
    shared < previous.length &&
    w[shared] === previous[shared]
  )
    shared++;
  out.push(`${mark}${shared}${w.slice(shared)}`);
  previous = w;
}
const target = new URL("../packages/correction-engine/data/en-words.txt", import.meta.url);
writeFileSync(target, `${out.join("\n")}\n`);
process.stdout.write(
  `${out.length} words (${noSuggest.size} never suggested) → ${target.pathname}\n`,
);
