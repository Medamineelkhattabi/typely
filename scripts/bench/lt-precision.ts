/**
 * Counts the LanguageTool fixes Typely would apply automatically to text that is already
 * correct (this repository's Markdown docs): each one is a false positive.
 *
 *   node scripts/bench/lt-precision.ts http://127.0.0.1:18082 README.md docs/**.md
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { DirectTransport, LanguageToolClient } from "@typely/provider-adapters";

const [url, ...roots] = process.argv.slice(2);
if (url === undefined) throw new Error("Usage: lt-precision.ts <url> <files or folders…>");
const files = roots.flatMap(function walk(path: string): string[] {
  return statSync(path).isDirectory()
    ? readdirSync(path).flatMap((name) => walk(join(path, name)))
    : path.endsWith(".md")
      ? [path]
      : [];
});
const transport = new DirectTransport({
  endpoints: new Map([["lt", { baseUrl: url, auth: { type: "none" as const } }]]),
  getSecret: () => undefined,
});
const client = new LanguageToolClient({ transport, endpointId: "lt" });
let paragraphs = 0;
let automatic = 0;
for (const file of files) {
  const text = readFileSync(file, "utf8").replace(/```[\s\S]*?```/g, "");
  for (const raw of text.split(/\n\s*\n/)) {
    const paragraph = raw
      // Markup goes, its words stay: removing "`id`" from "an `id`" would leave a false a/an.
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]+>|[*_#>|`]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (paragraph.length < 40 || !/[a-z]{3}/.test(paragraph)) continue;
    paragraphs++;
    for (const issue of await client.check(paragraph, "en")) {
      if (issue.auto_fix === false || issue.replacements.length !== 1) continue;
      automatic++;
      const fragment = paragraph.slice(issue.offset, issue.offset + issue.length);
      const around = paragraph.slice(
        Math.max(0, issue.offset - 50),
        issue.offset + issue.length + 30,
      );
      console.log(`${file}: "${fragment}" → "${issue.replacements[0]}" (${issue.rule_id})
    …${around}…`);
    }
  }
}
console.log(`\n${automatic} automatic fixes in ${paragraphs} paragraphs of correct text`);
