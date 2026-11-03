import { ProviderConfigSchema } from "@typely/schemas";
import { describe, expect, it } from "vitest";
import {
  type CompletionRequest,
  completeStreaming,
  createAdapter,
  DirectTransport,
  type EndpointDefinition,
  type Transport,
} from "../src/index.ts";

const ollama = createAdapter(
  ProviderConfigSchema.parse({ id: "ol", kind: "ollama", label: "Ollama", model: "m" }),
);
const request: CompletionRequest = {
  system: "S",
  user: "U",
  outputFormat: "text",
  suggestedMaxOutputTokens: 100,
};
const final =
  '{"model":"m","message":{"content":""},"done":true,"prompt_eval_count":3,"eval_count":2}';

describe("completeStreaming", () => {
  it("accumulates deltas and returns the final usage", async () => {
    const transport: Transport = {
      send: async () => {
        throw new Error("should stream");
      },
      stream: async (_id, _request, onLine) => {
        onLine('{"message":{"content":"Hel"},"done":false}');
        onLine('{"message":{"content":"lo"},"done":false}');
        onLine(final);
        return { status: 200, headers: {}, body: undefined };
      },
    };
    const seen: string[] = [];
    const response = await completeStreaming(ollama, transport, request, (t) => seen.push(t));
    expect(seen).toEqual(["Hel", "Hello"]);
    expect(response).toEqual({
      text: "Hello",
      model: "m",
      usage: { inputTokens: 3, outputTokens: 2 },
    });
  });

  it("falls back to a single request when the transport cannot stream", async () => {
    const transport: Transport = {
      send: async () => ({
        status: 200,
        headers: {},
        body: { model: "m", message: { content: "Hi" } },
      }),
    };
    const seen: string[] = [];
    expect((await completeStreaming(ollama, transport, request, (t) => seen.push(t))).text).toBe(
      "Hi",
    );
    expect(seen).toEqual(["Hi"]);
  });

  it("classifies HTTP errors and incomplete streams", async () => {
    const notFound: Transport = {
      send: async () => ({ status: 500, headers: {}, body: "x" }),
      stream: async () => ({ status: 404, headers: {}, body: { error: "model 'm' not found" } }),
    };
    await expect(completeStreaming(ollama, notFound, request, () => {})).rejects.toMatchObject({
      kind: "bad_request",
    });
    const cut: Transport = {
      send: async () => ({ status: 500, headers: {}, body: "x" }),
      stream: async (_id, _r, onLine) => {
        onLine('{"message":{"content":"Hel"},"done":false}');
        return { status: 200, headers: {}, body: undefined };
      },
    };
    await expect(completeStreaming(ollama, cut, request, () => {})).rejects.toMatchObject({
      kind: "invalid_response",
    });
  });
});

describe("DirectTransport.stream", () => {
  const endpoints = new Map<string, EndpointDefinition>([
    ["ol", { baseUrl: "http://localhost:11434", auth: { type: "none" } }],
  ]);

  it("splits NDJSON lines across arbitrary chunk boundaries", async () => {
    const chunks = ['{"a":1}\n{"b"', ':2}\n\n{"c":3}'];
    const fetchFake = (async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
            controller.close();
          },
        }),
        { status: 200 },
      )) as typeof fetch;
    const transport = new DirectTransport({
      endpoints,
      getSecret: () => undefined,
      fetch: fetchFake,
    });
    const lines: string[] = [];
    const res = await transport.stream("ol", { method: "POST", path: "/api/chat", body: {} }, (l) =>
      lines.push(l),
    );
    expect(lines).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
    expect(res.status).toBe(200);
  });

  it("returns the whole body for error statuses", async () => {
    const fetchFake = (async () =>
      new Response('{"error":"model not found"}', { status: 404 })) as typeof fetch;
    const transport = new DirectTransport({
      endpoints,
      getSecret: () => undefined,
      fetch: fetchFake,
    });
    const lines: string[] = [];
    const res = await transport.stream("ol", { method: "POST", path: "/api/chat" }, (l) =>
      lines.push(l),
    );
    expect(res).toMatchObject({ status: 404, body: { error: "model not found" } });
    expect(lines).toEqual([]);
  });
});
