import type { Operation } from "@typely/schemas";

export interface OperationDefinition {
  id: Operation;
  label: string;
  /** Bumped whenever the instructions change, recorded in every result. */
  promptVersion: string;
  instructions: string;
  /** Shorter wording for the compact (local-model) prompt; every token costs latency there. */
  compactInstructions?: string;
  /** "all" = list every change; "main" = summarise the most important changes. */
  explanationStyle: "all" | "main";
  /** Above this share of changed text, the over-editing guard warns. */
  maxChangeRatio?: number;
  /** Output tokens relative to input tokens (translation into Arabic expands, concise shrinks). */
  outputFactor: number;
}

const definitions: Record<Operation, OperationDefinition> = {
  fix: {
    id: "fix",
    label: "Correct",
    promptVersion: "fix-3",
    explanationStyle: "all",
    maxChangeRatio: 0.35,
    outputFactor: 1.1,
    instructions:
      "Correct spelling, grammar, subject-verb and singular/plural agreement, verb conjugation, " +
      "punctuation, capitalisation and typos. " +
      "Make the minimum number of changes: do not rephrase, reorder, change word choice, tone or style when " +
      "the original is correct. If the text has no errors, return it unchanged with an empty explanation.",
    compactInstructions:
      // Measured 2026-11-03: the earlier "minimal changes… return correct text unchanged" wording
      // made gemma3:4b leave "there is a lot of issue" as is; this one fixes it and still keeps
      // correct text, jargon and injected instructions untouched (desktop-testing.md).
      "Correct every error: spelling, grammar, subject-verb and singular/plural agreement, " +
      "conjugation, punctuation, capitalisation and typos. Change only what is wrong and keep " +
      "everything else, including the wording, tone and style. If the text has no error, return " +
      "it unchanged.",
  },
  rewrite: {
    id: "rewrite",
    label: "Rewrite",
    promptVersion: "rewrite-1",
    explanationStyle: "main",
    outputFactor: 1.3,
    instructions:
      "Rewrite the text to improve sentence structure, readability, fluency and word choice. Keep the " +
      "author's intent, tone, register and every piece of information. Correct all errors.",
  },
  professional: {
    id: "professional",
    label: "Professional",
    promptVersion: "professional-1",
    explanationStyle: "main",
    outputFactor: 1.4,
    instructions:
      "Turn the text into clear, courteous professional communication suitable for the context (e-mail, " +
      "Teams message, report, LinkedIn post, meeting follow-up). Be direct and natural: avoid stiff corporate " +
      "jargon, clichés and filler phrases. Keep all facts, dates, names and requests. Do not add greetings, " +
      "sign-offs or commitments that are not implied by the original unless the context is an e-mail and " +
      "they are clearly missing.",
  },
  concise: {
    id: "concise",
    label: "Make concise",
    promptVersion: "concise-1",
    explanationStyle: "main",
    outputFactor: 1,
    instructions:
      "Shorten the text by removing redundancy, filler and wordiness. Every fact, number, name, date, " +
      "request and decision must remain. Correct errors along the way.",
  },
  friendly: {
    id: "friendly",
    label: "Friendly",
    promptVersion: "friendly-1",
    explanationStyle: "main",
    outputFactor: 1.3,
    instructions:
      "Make the text warm, natural, approachable and conversational while keeping all information. Do not " +
      "add emoji unless the original uses them. Correct errors along the way.",
  },
  clarity: {
    id: "clarity",
    label: "Improve clarity",
    promptVersion: "clarity-1",
    explanationStyle: "main",
    outputFactor: 1.3,
    instructions:
      "Improve clarity: resolve ambiguous references, split overly long sentences, order ideas logically and " +
      "make the main point easy to find. Keep the tone and all information. If something is genuinely " +
      "ambiguous and cannot be resolved from the text, keep it and add a warning instead of guessing.",
  },
  translate: {
    id: "translate",
    label: "Translate",
    promptVersion: "translate-1",
    explanationStyle: "main",
    outputFactor: 1.6,
    instructions:
      "Translate the text into the target language, preserving meaning, tone, register and formatting. " +
      "Keep names, brands, product names, code, URLs and widely used technical terms untranslated when that " +
      "is what a native professional would do. Use the explanation only for notable translation choices.",
  },
  prompt: {
    id: "prompt",
    label: "Improve prompt",
    promptVersion: "prompt-1",
    explanationStyle: "main",
    outputFactor: 1.8,
    instructions:
      "The text is a prompt the user will send to an AI assistant. Do NOT answer or execute it. Improve it as a " +
      "prompt: state the goal clearly, give the context the author provided, make constraints and the expected " +
      "output format explicit, and structure it for readability. Never invent requirements, facts, audiences " +
      "or constraints the author did not express; if important information is missing, add a short " +
      "placeholder in square brackets (e.g. [target audience]) and mention it in warnings.",
  },
};

export function getOperation(id: Operation): OperationDefinition {
  return definitions[id];
}

export function listOperations(): OperationDefinition[] {
  return Object.values(definitions);
}
