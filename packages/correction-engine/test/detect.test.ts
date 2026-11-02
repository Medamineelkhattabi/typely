import { describe, expect, it } from "vitest";
import { createDefaultRegistry, detectLanguage, normalizeLanguageCode } from "../src/index.ts";

const registry = createDefaultRegistry();
const detect = (text: string) => detectLanguage(text, registry);

describe("detectLanguage", () => {
  it.each([
    ["fr", "Bonjour, je voulais savoir si tu as reçu mon message d'hier."],
    ["fr", "Merci pour ton retour, on se voit demain à la réunion."],
    ["en", "Hi team, can you check the deployment before the meeting tomorrow?"],
    ["en", "I don't think we're ready to ship this yet."],
    ["ar", "مرحبا، هل يمكنك مراجعة التقرير قبل الاجتماع غدا؟"],
  ])("detects %s", (language, text) => {
    const result = detect(text);
    expect(result.language).toBe(language);
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    expect(result.mixed).toBe(false);
  });

  it("keeps French with English technical terms as French", () => {
    const result = detect(
      "Le build du pipeline a échoué, je relance le deploy après le merge de la feature.",
    );
    expect(result.language).toBe("fr");
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("flags genuinely mixed French/English text", () => {
    const result = detect(
      "Je pense que la réunion est utile pour toute l'équipe. But honestly, I think we should move it to the afternoon.",
    );
    expect(result.mixed).toBe(true);
    expect(["fr", "en"]).toContain(result.language);
    expect(result.secondary).toBe(result.language === "fr" ? "en" : "fr");
  });

  it("detects Arabic mixed with Latin-script words", () => {
    const result = detect(
      "أرسلت لك الملف عبر Teams و email، أرجو أن تراجعه قبل الاجتماع غدا please",
    );
    expect(result.language).toBe("ar");
    expect(result.mixed).toBe(true);
  });

  it("gives lower confidence to very short texts", () => {
    const result = detect("Merci");
    expect(result.language).toBe("fr");
    expect(result.confidence).toBeLessThan(0.8);
  });

  it("returns und for text without evidence or in unprofiled languages", () => {
    expect(detect("ok").language).toBe("und");
    expect(detect("12345 !!!").language).toBe("und");
    expect(detect("").language).toBe("und");
    expect(detect("Hola, ¿cómo estás? Espero que todo vaya bien con el proyecto.").language).toBe(
      "und",
    );
  });

  it("ignores URLs, code and e-mail addresses", () => {
    const result = detect(
      "Voici le lien https://example.com/the-best-of-the-web et `const the = this` pour toi.",
    );
    expect(result.language).toBe("fr");
  });
});

describe("normalizeLanguageCode", () => {
  it.each([
    ["French", "fr"],
    ["fr_fr", "fr-FR"],
    ["EN", "en"],
    ["العربية", "ar"],
    ["klingon!", "und"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeLanguageCode(input)).toBe(expected);
  });
});
