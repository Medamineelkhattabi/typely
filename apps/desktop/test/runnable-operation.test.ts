import { describe, expect, it } from "vitest";
import { runnableOperation } from "../src/settings.ts";

describe("runnableOperation", () => {
  it("keeps the chosen action when an AI model is available", () => {
    expect(runnableOperation("rewrite", false)).toBe("rewrite");
    expect(runnableOperation("translate", false)).toBe("translate");
  });

  it("falls back to correcting in local mode, which cannot run anything else", () => {
    expect(runnableOperation("rewrite", true)).toBe("fix");
    expect(runnableOperation("fix", true)).toBe("fix");
  });
});
