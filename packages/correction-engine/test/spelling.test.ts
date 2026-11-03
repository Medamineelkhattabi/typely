import { readFileSync } from "node:fs";
import type { Transport } from "@typely/provider-adapters";
import { describe, expect, it } from "vitest";
import {
  CorrectionEngine,
  combineSpellers,
  decodeWordList,
  type Speller,
  singleEdit,
  spellingIssue,
  WordListSpeller,
} from "../src/index.ts";

const words = readFileSync(new URL("../data/en-words.txt", import.meta.url), "utf8");
const speller = new WordListSpeller(words);

/** The fixes the speller would apply on its own (exactly one replacement). */
function autoFixes(text: string, language = "en"): string[] {
  return speller
    .check(text, language)
    .filter((i) => i.replacements.length === 1)
    .map((i) => `${text.slice(i.offset, i.offset + i.length)}→${i.replacements[0]}`);
}

describe("bundled English word list", () => {
  it("decodes the front-coded list", () => {
    const { valid, suggestable } = decodeWordList("0apple\n5s\n2t\n!0zzz\n0Paris\n");
    expect([...valid].sort()).toEqual(["apple", "apples", "apt", "paris", "zzz"]);
    expect(suggestable.has("zzz")).toBe(false);
    expect(suggestable.has("paris")).toBe(false);
    expect(suggestable.has("apt")).toBe(true);
  });

  it("knows US and British spellings, plurals and possessives", () => {
    for (const w of [
      "impressive",
      "colour",
      "color",
      "organisation",
      "favourite",
      "integrations",
      "Typely's",
      "can't",
      "don’t",
    ])
      expect(speller.isValid(w), w).toBe(w !== "Typely's");
    expect(speller.isValid("imlpressive")).toBe(false);
  });
});

const noNetwork: Transport = {
  send: async () => {
    throw new Error("no network in this test");
  },
};

describe("spelling policy", () => {
  it("classifies single edits", () => {
    expect(singleEdit("reprot", "report")).toMatchObject({
      kind: "transposition",
      typoShaped: true,
    });
    expect(singleEdit("tomorow", "tomorrow")).toMatchObject({
      kind: "insertion",
      typoShaped: true,
    });
    expect(singleEdit("untill", "until")).toMatchObject({ kind: "deletion", typoShaped: true });
    expect(singleEdit("imlpressive", "impressive")).toMatchObject({
      kind: "deletion",
      typoShaped: true,
    });
    expect(singleEdit("keyring", "keying")).toMatchObject({ typoShaped: false });
    expect(singleEdit("ollama", "llama")).toMatchObject({ typoShaped: false });
    expect(singleEdit("bundler", "bundle")).toMatchObject({ typoShaped: false });
    expect(singleEdit("salut", "slut")).toMatchObject({ typoShaped: false });
    expect(singleEdit("blocklisted", "blacklisted")).toMatchObject({ typoShaped: false });
    expect(singleEdit("abc", "xyz")).toBeUndefined();
  });

  it("fixes the reported typo and keeps the case", () => {
    const text =
      "Make it commercial repo make it very interesting with catchy readme file imlpressive dynamic and all that";
    expect(autoFixes(text)).toEqual(["imlpressive→impressive"]);
    expect(autoFixes("Imlpressive work.")).toEqual(["Imlpressive→Impressive"]);
  });

  it("fixes typo-shaped mistakes", () => {
    expect(
      autoFixes("Can you send me the reprot before the meeting tomorow? I recieve it."),
    ).toEqual(["reprot→report", "tomorow→tomorrow", "recieve→receive"]);
  });

  it("leaves jargon, names, acronyms, identifiers and foreign words alone", () => {
    for (const text of [
      "We deployed kubectl and Tauri on Kubernetes with gemma3:1b via Ollama.",
      "The keyring crate and rustup are fine; reqwest handles HTTP.",
      "Our bundler compiles every shader.",
      "Je suis allé à la réunion, salut.",
      "Open config.yaml and set API_KEY or useEffect in the README.",
      "The blocklisted sites stay blocked.",
    ])
      expect(autoFixes(text), text).toEqual([]);
  });

  it("only adds accents, never removes them", () => {
    const add = spellingIssue(
      "C'est interessant.",
      6,
      "interessant",
      ["intéressant", "intéressante"],
      {
        language: "fr",
      },
    );
    expect(add?.replacements).toEqual(["intéressant"]);
    const remove = spellingIssue("le passé", 3, "passé", ["passe"], { language: "en" });
    expect(remove?.replacements ?? []).toEqual([]);
  });

  it("applies a checker's confident replacement, and never applies an uncertain one", () => {
    const sure = spellingIssue("c'etait", 2, "etait", ["était"], {
      language: "fr",
      confident: "était",
    });
    expect(sure).toMatchObject({
      replacements: ["était"],
      rule_id: "FR_SPELLING",
      severity: "error",
    });
    // Two plausible words: listed, not applied.
    const two = spellingIssue("il a recu", 5, "recu", ["reçu", "recul", "reçue"], {
      language: "fr",
    });
    expect(two?.replacements).toEqual(["reçu"]);
    const weak = spellingIssue("the keyring", 4, "keyring", ["keying"], { language: "en" });
    expect(weak).toMatchObject({ replacements: [], severity: "suggestion" });
    expect(weak?.message).toContain("keying");
  });

  it("checks a lone, undetected ASCII word as English", async () => {
    expect(autoFixes("imlpressive", "und")).toEqual(["imlpressive→impressive"]);
    expect(autoFixes("maison", "und")).toEqual([]);
    expect(autoFixes("réunion", "und")).toEqual([]);
    const engine = new CorrectionEngine({ settings: {}, transport: noNetwork, speller });
    const result = await engine.run({ operation: "fix", mode: "local", text: "imlpressive" });
    expect(result.corrected_text).toBe("impressive");
  });

  it("does not check other languages", () => {
    expect(speller.check("Je voudrais un raport complet.", "fr")).toEqual([]);
  });
});

describe("engine integration", () => {
  const noModel: Transport = {
    send: async () => {
      throw new Error("no network in this test");
    },
  };

  it("applies spelling fixes in local mode and reports them as local findings", async () => {
    const engine = new CorrectionEngine({ settings: {}, transport: noModel, speller });
    const result = await engine.run({
      operation: "fix",
      mode: "local",
      text: "Make it a catchy readme file, imlpressive and dynamic.",
    });
    expect(result.corrected_text).toBe("Make it a catchy readme file, impressive and dynamic.");
    expect(result.explanation).toContainEqual(
      expect.objectContaining({
        original: "imlpressive",
        corrected: "impressive",
        category: "spelling",
        source: "local",
      }),
    );
  });

  it("sends the spell-fixed text to a plain-text model (hybrid pre-pass)", async () => {
    const seen: string[] = [];
    const ollama: Transport = {
      send: async (_id, request) => {
        const body = request.body as { messages: { content: string }[] };
        seen.push(body.messages[1]?.content ?? "");
        const echoed = (body.messages[1]?.content ?? "").replace(/<\/?text>/g, "").trim();
        return {
          status: 200,
          headers: {},
          body: {
            model: "gemma3:1b",
            message: { content: echoed },
            done: true,
            done_reason: "stop",
          },
        };
      },
    };
    const engine = new CorrectionEngine({
      settings: { providers: [{ id: "local", kind: "ollama", label: "L", model: "gemma3:1b" }] },
      transport: ollama,
      speller,
    });
    const result = await engine.run({ operation: "fix", text: "A file imlpressive and dynamic." });
    expect(seen[0]).toContain("impressive");
    expect(result.corrected_text).toBe("A file impressive and dynamic.");
  });

  /** A fake Ollama: records what it receives and answers with `reply(userText)`. */
  function fakeOllama(reply: (userText: string) => string) {
    const seen: string[] = [];
    const transport: Transport = {
      send: async (_id, request) => {
        const body = request.body as { messages: { content: string }[] };
        const user = (body.messages[1]?.content ?? "").replace(/<\/?text>/g, "").trim();
        seen.push(user);
        return {
          status: 200,
          headers: {},
          body: { model: "gemma3:4b", message: { content: reply(user) }, done: true },
        };
      },
    };
    const engine = new CorrectionEngine({
      settings: { providers: [{ id: "local", kind: "ollama", label: "L", model: "gemma3:4b" }] },
      transport,
      speller,
    });
    return { engine, seen };
  }

  it("every action starts from the spell-fixed text", async () => {
    for (const operation of [
      "rewrite",
      "professional",
      "concise",
      "friendly",
      "clarity",
      "prompt",
    ] as const) {
      const { engine, seen } = fakeOllama((t) => t);
      const result = await engine.run({
        operation,
        text: "Make the readme file imlpressive and dynamic.",
      });
      expect(seen[0], operation).toContain("impressive");
      expect(seen[0], operation).not.toContain("imlpressive");
      expect(result.corrected_text, operation).not.toContain("imlpressive");
      expect(result.explanation, operation).toContainEqual(
        expect.objectContaining({
          original: "imlpressive",
          corrected: "impressive",
          source: "local",
        }),
      );
      const keys = result.explanation.map((e) => `${e.original}→${e.corrected}`);
      expect(new Set(keys).size, operation).toBe(keys.length);
    }
  });

  it("spell-checks what the model wrote, in the output language", async () => {
    const { engine } = fakeOllama(() => "Please send me the reprot before the meeting.");
    const rewrite = await engine.run({
      operation: "professional",
      text: "send me the report asap",
    });
    expect(rewrite.corrected_text).toBe("Please send me the report before the meeting.");

    const translate = fakeOllama(() => "I will send it tommorrow morning.");
    const result = await translate.engine.run({
      operation: "translate",
      target_language: "en",
      text: "Je vous l'envoie demain matin.",
    });
    expect(result.corrected_text).toBe("I will send it tomorrow morning.");
  });

  it("leaves model-only mode untouched", async () => {
    const { engine, seen } = fakeOllama(() => "An imlpressive result.");
    const result = await engine.run({
      operation: "rewrite",
      mode: "ai",
      text: "An imlpressive result.",
    });
    expect(seen[0]).toBe("An imlpressive result.");
    expect(result.corrected_text).toBe("An imlpressive result.");
  });

  it("respects disabled rules and protected spans, and survives a failing speller", async () => {
    const off = new CorrectionEngine({
      settings: { disabled_rules: ["EN_SPELLING"] },
      transport: noModel,
      speller,
    });
    const kept = await off.run({ operation: "fix", mode: "local", text: "An imlpressive result." });
    expect(kept.corrected_text).toBe("An imlpressive result.");

    const engine = new CorrectionEngine({ settings: {}, transport: noModel, speller });
    const code = await engine.run({
      operation: "fix",
      mode: "local",
      text: "Run `imlpressive --fast` now.",
    });
    expect(code.corrected_text).toBe("Run `imlpressive --fast` now.");

    const broken: Speller = { check: () => Promise.reject(new Error("checker crashed")) };
    const resilient = new CorrectionEngine({
      settings: {},
      transport: noModel,
      speller: combineSpellers(broken),
    });
    const result = await resilient.run({ operation: "fix", mode: "local", text: "i think so." });
    expect(result.corrected_text).toBe("I think so.");
  });

  it("combines spellers; the first one wins on the same span", async () => {
    const other: Speller = {
      check: (text) => [
        {
          offset: text.indexOf("imlpressive"),
          length: 11,
          message: "x",
          category: "spelling",
          replacements: ["WRONG"],
          source: "local",
          rule_id: "EN_SPELLING",
          severity: "error",
        },
      ],
    };
    const issues = await combineSpellers(speller, other).check("An imlpressive result.", "en");
    expect(issues.map((i) => i.replacements)).toEqual([["impressive"]]);
  });
});
