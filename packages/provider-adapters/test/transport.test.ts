import { describe, expect, it, vi } from "vitest";
import {
  DirectTransport,
  type EndpointDefinition,
  isLoopbackUrl,
  joinEndpointUrl,
  ProviderError,
} from "../src/index.ts";

interface Captured {
  url: string;
  init: RequestInit;
}

function fakeFetch(response: () => Response | Promise<Response>) {
  const calls: Captured[] = [];
  const fn = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return response();
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const endpoints = new Map<string, EndpointDefinition>([
  ["oa", { baseUrl: "https://api.openai.com/v1", auth: { type: "bearer", optional: false } }],
  [
    "an",
    {
      baseUrl: "https://api.anthropic.com",
      auth: { type: "header", name: "x-api-key", optional: false },
    },
  ],
  [
    "lt",
    {
      baseUrl: "http://localhost:8081",
      auth: { type: "form_field", name: "apiKey", optional: true },
    },
  ],
  ["ol", { baseUrl: "http://localhost:11434", auth: { type: "none" } }],
]);
const secrets: Record<string, string> = { oa: "sk-openai", an: "sk-ant", lt: "lt-key" };
const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, ...init });

describe("DirectTransport", () => {
  it("attaches bearer auth and keeps the key out of the URL and body", async () => {
    const { fn, calls } = fakeFetch(() => json({ ok: true }));
    const transport = new DirectTransport({ endpoints, getSecret: (id) => secrets[id], fetch: fn });
    const res = await transport.send("oa", {
      method: "POST",
      path: "/chat/completions",
      body: { a: 1 },
    });
    expect(res).toMatchObject({ status: 200, body: { ok: true } });
    const call = calls[0];
    expect(call?.url).toBe("https://api.openai.com/v1/chat/completions");
    const headers = new Headers(call?.init.headers);
    expect(headers.get("authorization")).toBe("Bearer sk-openai");
    expect(call?.init.body).toBe('{"a":1}');
    expect(call?.init.redirect).toBe("error");
    expect(call?.init.credentials).toBe("omit");
  });

  it("ignores auth headers supplied by callers", async () => {
    const { fn, calls } = fakeFetch(() => json({}));
    const transport = new DirectTransport({ endpoints, getSecret: (id) => secrets[id], fetch: fn });
    await transport.send("an", {
      method: "POST",
      path: "/v1/messages",
      body: {},
      headers: {
        "X-Api-Key": "attacker",
        Authorization: "Bearer attacker",
        "anthropic-version": "2023-06-01",
      },
    });
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get("x-api-key")).toBe("sk-ant");
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("anthropic-version")).toBe("2023-06-01");
  });

  it("puts form-field secrets in the form body", async () => {
    const { fn, calls } = fakeFetch(() => json({ matches: [] }));
    const transport = new DirectTransport({ endpoints, getSecret: (id) => secrets[id], fetch: fn });
    await transport.send("lt", {
      method: "POST",
      path: "/v2/check",
      encoding: "form",
      body: { text: "a b", language: "fr" },
    });
    const body = new URLSearchParams(String(calls[0]?.init.body));
    expect(body.get("apiKey")).toBe("lt-key");
    expect(body.get("text")).toBe("a b");
    expect(calls[0]?.url).not.toContain("lt-key");
  });

  it("refuses paths that would change the host", async () => {
    const { fn } = fakeFetch(() => json({}));
    const transport = new DirectTransport({ endpoints, getSecret: (id) => secrets[id], fetch: fn });
    for (const path of ["//evil.com/x", "https://evil.com", "\\\\evil", "chat"]) {
      await expect(transport.send("oa", { method: "GET", path })).rejects.toThrow();
    }
    expect(fn).not.toHaveBeenCalled();
  });

  it("reports missing configuration", async () => {
    const { fn } = fakeFetch(() => json({}));
    const transport = new DirectTransport({ endpoints, getSecret: () => undefined, fetch: fn });
    await expect(transport.send("nope", { method: "GET", path: "/x" })).rejects.toMatchObject({
      kind: "not_configured",
    });
    await expect(transport.send("oa", { method: "GET", path: "/models" })).rejects.toMatchObject({
      kind: "not_configured",
    });
    // Optional keys and keyless endpoints still work.
    await expect(transport.send("ol", { method: "GET", path: "/api/tags" })).resolves.toMatchObject(
      { status: 200 },
    );
  });

  it("returns non-2xx responses and plain-text bodies instead of throwing", async () => {
    const { fn } = fakeFetch(
      () => new Response("Bad gateway", { status: 502, headers: { "Retry-After": "2" } }),
    );
    const transport = new DirectTransport({ endpoints, getSecret: (id) => secrets[id], fetch: fn });
    const res = await transport.send("ol", { method: "GET", path: "/api/tags" });
    expect(res).toEqual({
      status: 502,
      headers: expect.objectContaining({ "retry-after": "2" }),
      body: "Bad gateway",
    });
  });

  it("explains connection errors hidden in nested causes", async () => {
    const refused = Object.assign(new Error(""), { code: "ECONNREFUSED" });
    const transport = new DirectTransport({
      endpoints,
      getSecret: () => undefined,
      fetch: (async () => {
        throw new TypeError("fetch failed", { cause: new AggregateError([refused], "") });
      }) as typeof fetch,
    });
    await expect(transport.send("ol", { method: "GET", path: "/" })).rejects.toThrow(
      "fetch failed: connection refused — is the server running?",
    );
  });

  it("maps network failures, timeouts and cancellation", async () => {
    const network = new DirectTransport({
      endpoints,
      getSecret: () => undefined,
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch,
    });
    await expect(network.send("ol", { method: "GET", path: "/" })).rejects.toMatchObject({
      kind: "network",
    });

    const hanging = (async (_url: unknown, init?: RequestInit) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as typeof fetch;
    const slow = new DirectTransport({ endpoints, getSecret: () => undefined, fetch: hanging });
    await expect(
      slow.send("ol", { method: "GET", path: "/", timeoutMs: 20 }),
    ).rejects.toMatchObject({ kind: "timeout" });

    const controller = new AbortController();
    const pending = slow.send("ol", { method: "GET", path: "/" }, controller.signal);
    controller.abort();
    const error = await pending.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).kind).toBe("cancelled");
  });
});

describe("endpoint helpers", () => {
  it("joins paths under the base path only", () => {
    expect(joinEndpointUrl("https://h.example/v1/", "/models?x=1").toString()).toBe(
      "https://h.example/v1/models?x=1",
    );
    expect(() => joinEndpointUrl("https://h.example/v1", "/../admin")).toThrow();
  });

  it("recognises loopback hosts", () => {
    for (const url of [
      "http://localhost:11434",
      "http://127.0.0.1",
      "http://[::1]:8080",
      "http://app.localhost",
    ]) {
      expect(isLoopbackUrl(url)).toBe(true);
    }
    for (const url of [
      "https://api.openai.com",
      "http://192.168.1.10",
      "http://localhost.evil.com",
      "not a url",
    ]) {
      expect(isLoopbackUrl(url)).toBe(false);
    }
  });
});
