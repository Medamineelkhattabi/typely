import { diffWords } from "@typely/correction-engine";
import { describe, expect, it } from "vitest";
import { countChanges } from "../src/components/CorrectionStage.tsx";

describe("countChanges", () => {
  it("counts a replaced word once", () => {
    expect(
      countChanges(diffWords("Il faut que tu vien demain", "Il faut que tu viennes demain")),
    ).toBe(1);
  });

  it("counts separate fixes separately", () => {
    const original = "Les enfants on mangé tout les gâteaux";
    expect(countChanges(diffWords(original, "Les enfants ont mangé tous les gâteaux"))).toBe(2);
  });

  it("is zero for unchanged text", () => {
    expect(countChanges(diffWords("Je suis content.", "Je suis content."))).toBe(0);
  });
});
