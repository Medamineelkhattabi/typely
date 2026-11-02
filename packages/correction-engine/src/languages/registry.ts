import { arabic } from "./ar.ts";
import { english } from "./en.ts";
import { french } from "./fr.ts";
import type { LanguageProfile } from "./types.ts";

export class LanguageRegistry {
  readonly #profiles = new Map<string, LanguageProfile>();

  constructor(profiles: readonly LanguageProfile[] = []) {
    for (const profile of profiles) this.register(profile);
  }

  register(profile: LanguageProfile): void {
    if (this.#profiles.has(profile.code)) {
      throw new Error(`Language '${profile.code}' is already registered`);
    }
    this.#profiles.set(profile.code, profile);
  }

  /** Resolves "fr", "fr-CA" or "FR" to the French profile. */
  get(code: string): LanguageProfile | undefined {
    return this.#profiles.get(code.toLowerCase().split("-")[0] ?? "");
  }

  all(): LanguageProfile[] {
    return [...this.#profiles.values()];
  }
}

export function createDefaultRegistry(): LanguageRegistry {
  return new LanguageRegistry([french, english, arabic]);
}

const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  french: "fr",
  français: "fr",
  francais: "fr",
  english: "en",
  anglais: "en",
  arabic: "ar",
  arabe: "ar",
  العربية: "ar",
  spanish: "es",
  german: "de",
  italian: "it",
  portuguese: "pt",
  dutch: "nl",
};

/** Normalises what an LLM returns ("French", "fr_FR", "EN") into a language code or "und". */
export function normalizeLanguageCode(value: string): string {
  const trimmed = value.trim();
  const byName = LANGUAGE_NAMES[trimmed.toLowerCase()];
  if (byName !== undefined) return byName;
  const match = /^([a-zA-Z]{2,3})(?:[-_]([a-zA-Z]{2}))?$/.exec(trimmed);
  if (match === null) return "und";
  const [, language = "", region] = match;
  return region === undefined
    ? language.toLowerCase()
    : `${language.toLowerCase()}-${region.toUpperCase()}`;
}
