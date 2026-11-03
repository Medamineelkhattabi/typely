import { describe, expect, it } from "vitest";
import { english, fixLocally } from "../src/index.ts";
import { pluralise } from "../src/languages/en-agreement.ts";

const fix = (text: string) => fixLocally(text, "en", english).text;

describe("English number agreement", () => {
  it("pluralises the noun after a quantifier and fixes the verb", () => {
    expect(fix("There is a lot of issue.")).toBe("There are a lot of issues.");
    expect(fix("Hello, there is a lot of issue.")).toBe("Hello, there are a lot of issues.");
    expect(fix("We have three meeting tomorrow.")).toBe("We have three meetings tomorrow.");
    expect(fix("I found several bug, and two crash.")).toBe(
      "I found several bugs, and two crashes.",
    );
    expect(fix("There's a lot of problems here.")).toBe("There are a lot of problems here.");
    expect(fix("There was many error.")).toBe("There were many errors.");
    expect(fix("We need a lot of copy.")).toBe("We need a lot of copy.");
  });

  it("leaves correct, uncountable and ambiguous phrases alone", () => {
    for (const text of [
      "There are a lot of issues.",
      "There is a lot of information.",
      "We did a lot of work.",
      "It was a lot of fun.",
      "There is a lot of news.",
      "There is a lot of interest in it.",
      "There is a lot of us.",
      "Many people came.",
      "Two of them left.",
      "Many thanks.",
      "We saw several new features.",
      "These issue are fixed.", // not before the end of a clause: left to the model
      "Ollama 0.40.7 portable, started by hand.",
      "SHA-256 verified.",
      "Phase 2 desktop",
      "Both working.",
      "We saw a lot of photo.",
    ])
      expect(fix(text), text).toBe(text);
  });

  it("forms regular plurals and refuses unsafe ones", () => {
    expect(pluralise("issue")).toBe("issues");
    expect(pluralise("query")).toBe("queries");
    expect(pluralise("box")).toBe("boxes");
    expect(pluralise("child")).toBe("children");
    for (const noun of ["photo", "knife", "roof", "bus"])
      expect(pluralise(noun), noun).toBeUndefined();
  });
});
