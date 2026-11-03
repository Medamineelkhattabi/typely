import { describe, expect, it } from "vitest";
import { fixLocally, french } from "../src/index.ts";

const fix = (text: string) => fixLocally(text, "fr", french).text;

describe("French subjunctive (FR_SUBJONCTIF)", () => {
  it("puts the verb in the subjunctive after expressions that require it", () => {
    expect(fix("Il faut que tu vien demain.")).toBe("Il faut que tu viennes demain.");
    expect(fix("Il faut que tu viens demain.")).toBe("Il faut que tu viennes demain.");
    expect(fix("Il faut que tu fais attention.")).toBe("Il faut que tu fasses attention.");
    expect(fix("Bien qu'il est tard, on continue.")).toBe("Bien qu'il soit tard, on continue.");
    expect(fix("Je veux qu’elle vient avec nous.")).toBe("Je veux qu’elle vienne avec nous.");
    expect(fix("Pour que tu peux venir, je t'attends.")).toBe(
      "Pour que tu puisses venir, je t'attends.",
    );
  });

  it("leaves the indicative where it is right", () => {
    for (const text of [
      "Je pense que tu viens demain.",
      "Il dit qu'il vient ce soir.",
      "Il faut que tu manges.",
      "Il faut que tu le fasses.",
      "Il faut que tu viennes.",
      "Je sais qu'il est là.",
      "Parce qu'il a raison.",
    ])
      expect(fix(text)).toBe(text);
  });
});

describe("se rendre compte (FR_RENDU_COMPTE)", () => {
  it("keeps the participle invariable", () => {
    expect(fix("Elle s'est rendue compte de son erreur.")).toBe(
      "Elle s'est rendu compte de son erreur.",
    );
    expect(fix("Nous nous sommes rendus compte du problème.")).toBe(
      "Nous nous sommes rendu compte du problème.",
    );
    for (const text of ["Elle s'est rendu compte de son erreur.", "Elle est rendue à Paris."])
      expect(fix(text)).toBe(text);
  });
});
