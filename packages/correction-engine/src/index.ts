export { detectLanguage, type LanguageDetection } from "./detect.ts";
export {
  type CheckOptions,
  CorrectionEngine,
  type CorrectionEngineOptions,
  endpointsFromSettings,
  LANGUAGETOOL_ENDPOINT_ID,
  type ProviderTestResult,
  type RunOptions,
} from "./engine.ts";
export { ENGINE_ERROR_CODES, EngineError, type EngineErrorCode } from "./errors.ts";
export { runGuards } from "./guards.ts";
export { arabic } from "./languages/ar.ts";
export { english } from "./languages/en.ts";
export { french, NBSP, NNBSP } from "./languages/fr.ts";
export {
  createDefaultRegistry,
  LanguageRegistry,
  normalizeLanguageCode,
} from "./languages/registry.ts";
export type { LanguageProfile, PhraseCorrection } from "./languages/types.ts";
export { getOperation, listOperations, type OperationDefinition } from "./operations.ts";
export { extractJson, parseLlmOutput } from "./parse.ts";
export {
  buildPrompt,
  buildRepairPrompt,
  chooseDelimiter,
  estimateOutputTokens,
  type PromptInput,
  type PromptProfile,
  stripEchoedDelimiters,
} from "./prompts.ts";
export {
  applyFixes,
  fixLocally,
  type LocalFixResult,
  mergeIssues,
  runLocalRules,
} from "./rules/index.ts";
export type { LocalRule, RuleContext, RuleMatch } from "./rules/types.ts";
export { changeRatio, diffWords, tokenize } from "./text/diff.ts";
export { findProtectedSpans, type ProtectedSpan } from "./text/protected.ts";
