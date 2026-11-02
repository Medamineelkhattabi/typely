import { describe, expect, it } from "vitest";
import { LanguageToolClient, type ProviderHttpRequest, type Transport } from "../src/index.ts";

function transportReturning(body: unknown, status = 200) {
  const requests: ProviderHttpRequest[] = [];
  const transport: Transport = {
    send: async (_id, request) => {
      requests.push(request);
      return { status, headers: {}, body };
    },
  };
  return { transport, requests };
}

describe("LanguageToolClient", () => {
  it("sends a form request with a spell-checkable language variant and maps matches", async () => {
    const text = "This are a tset.";
    const { transport, requests } = transportReturning({
      matches: [
        {
          message: "Agreement error",
          offset: 5,
          length: 3,
          replacements: [{ value: "is" }],
          rule: { id: "THIS_NNS", issueType: "grammar", category: { id: "GRAMMAR" } },
        },
        {
          message: "Possible spelling mistake",
          offset: 11,
          length: 4,
          replacements: [{ value: "test" }, { value: "set" }],
          rule: {
            id: "MORFOLOGIK_RULE_EN_US",
            issueType: "misspelling",
            category: { id: "TYPOS" },
          },
        },
        { message: "out of range", offset: 40, length: 2, rule: {} },
      ],
    });
    const client = new LanguageToolClient({ transport, endpointId: "languagetool" });
    const issues = await client.check(text, "en");

    expect(requests[0]).toMatchObject({
      method: "POST",
      path: "/v2/check",
      encoding: "form",
      body: { text, language: "en-US" },
    });
    expect(requests[0]?.body).not.toHaveProperty("apiKey");
    expect(issues).toEqual([
      {
        offset: 5,
        length: 3,
        message: "Agreement error",
        category: "grammar",
        replacements: ["is"],
        source: "languagetool",
        rule_id: "LT:THIS_NNS",
        severity: "error",
      },
      expect.objectContaining({
        category: "spelling",
        replacements: ["test", "set"],
        severity: "error",
      }),
    ]);
  });

  it("uses auto-detection for undetermined language and surfaces HTTP errors", async () => {
    const { transport, requests } = transportReturning({ matches: [] });
    await new LanguageToolClient({ transport, endpointId: "lt" }).check("x", "und");
    expect((requests[0]?.body as Record<string, string> | undefined)?.["language"]).toBe("auto");

    const failing = transportReturning("Service unavailable", 503);
    await expect(
      new LanguageToolClient({ transport: failing.transport, endpointId: "lt" }).check("x", "fr"),
    ).rejects.toMatchObject({ kind: "server" });
  });
});
