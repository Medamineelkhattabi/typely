import { CorrectionEngine, endpointsFromSettings } from "@typely/correction-engine";
import { DirectTransport } from "@typely/provider-adapters";
import type { EngineSettingsInput } from "@typely/schemas";
import { describe, expect, it } from "vitest";

/**
 * Full stack: engine → adapter → DirectTransport → fetch, with fetch faked at the edge.
 * Verifies what actually leaves the process for each provider.
 */
describe("engine + DirectTransport", () => {
  const settings: EngineSettingsInput = {
    default_mode: "ai",
    privacy: { cloud_processing_allowed: true },
    providers: [
      {
        id: "gemini",
        kind: "gemini",
        label: "Gemini",
        model: "gemini-test",
        consent_granted: true,
      },
      { id: "openai", kind: "openai", label: "OpenAI", model: "gpt-test", consent_granted: true },
    ],
  };
  const secrets: Record<string, string> = { gemini: "AIza-secret", openai: "sk-secret" };

  function setup(respond: (url: string) => Response) {
    const seen: Array<{ url: string; headers: Headers; body: string }> = [];
    const fetchFake = (async (url: URL | RequestInfo, init?: RequestInit) => {
      seen.push({
        url: String(url),
        headers: new Headers(init?.headers),
        body: String(init?.body),
      });
      return respond(String(url));
    }) as typeof fetch;
    const transport = new DirectTransport({
      endpoints: endpointsFromSettings(settings),
      getSecret: (id) => secrets[id],
      fetch: fetchFake,
    });
    return {
      engine: new CorrectionEngine({ settings, transport, chain: { sleep: async () => {} } }),
      seen,
    };
  }

  const output = JSON.stringify({
    corrected_text: "Thanks for your help.",
    detected_language: "en",
    explanation: [
      { original: "you", corrected: "your", reason: "Possessive", category: "grammar" },
    ],
    confidence: 0.97,
    warnings: [],
  });

  it("sends the Gemini key only as a header and falls back to OpenAI on a server error", async () => {
    const { engine, seen } = setup((url) =>
      url.includes("generativelanguage")
        ? new Response(JSON.stringify({ error: { message: "overloaded" } }), { status: 503 })
        : Response.json({
            model: "gpt-test",
            choices: [{ message: { content: output }, finish_reason: "stop" }],
            usage: { prompt_tokens: 120, completion_tokens: 30 },
          }),
    );
    const result = await engine.run({ operation: "fix", text: "Thanks for you help." });

    expect(result.corrected_text).toBe("Thanks for your help.");
    expect(result.meta.provider_id).toBe("openai");
    // 1 try + 1 retry on Gemini (retryable 503), then OpenAI.
    expect(seen.map((s) => new URL(s.url).host)).toEqual([
      "generativelanguage.googleapis.com",
      "generativelanguage.googleapis.com",
      "api.openai.com",
    ]);
    const gemini = seen[0];
    expect(gemini?.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent",
    );
    expect(gemini?.headers.get("x-goog-api-key")).toBe("AIza-secret");
    expect(gemini?.headers.get("authorization")).toBeNull();
    expect(seen[2]?.headers.get("authorization")).toBe("Bearer sk-secret");
    for (const request of seen) {
      expect(request.body).not.toContain("secret");
      expect(request.url).not.toContain("secret");
    }
  });
});
