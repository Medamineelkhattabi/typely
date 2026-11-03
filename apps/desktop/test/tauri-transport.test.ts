import { completeStreaming, OllamaAdapter, ProviderError } from "@typely/provider-adapters";
import { ProviderConfigSchema } from "@typely/schemas";
import { describe, expect, it } from "vitest";
import { type StreamMessage, type TauriBindings, TauriTransport } from "../src/tauri-transport.ts";

type Handler = (
  command: string,
  args: Record<string, unknown>,
  emit: (message: StreamMessage) => void,
) => Promise<unknown>;

function fakeBindings(handler: Handler) {
  const calls: { command: string; args: Record<string, unknown> }[] = [];
  const channels = new Map<unknown, (message: StreamMessage) => void>();
  const bindings: TauriBindings = {
    invoke: async <T>(command: string, args: Record<string, unknown>) => {
      calls.push({ command, args });
      const channel = channels.get(args["onLine"]);
      return (await handler(command, args, (m) => channel?.(m))) as T;
    },
    createChannel: (onMessage) => {
      const token = { channel: channels.size };
      channels.set(token, onMessage);
      return token;
    },
    newRequestId: () => `req-${calls.length}`,
  };
  return { bindings, calls };
}

describe("TauriTransport", () => {
  it("sends by endpoint id and never includes a secret", async () => {
    const { bindings, calls } = fakeBindings(async () => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: { ok: true },
    }));
    const transport = new TauriTransport(bindings);
    const response = await transport.send("anthropic", {
      method: "POST",
      path: "/v1/messages",
      body: { x: 1 },
    });
    expect(response).toEqual({
      status: 200,
      headers: { "content-type": "application/json" },
      body: { ok: true },
    });
    expect(calls[0]).toEqual({
      command: "provider_request",
      args: {
        endpointId: "anthropic",
        request: { method: "POST", path: "/v1/messages", body: { x: 1 } },
        requestId: "req-0",
      },
    });
  });

  it("maps Rust transport errors to ProviderError", async () => {
    const { bindings } = fakeBindings(async () => {
      throw { kind: "timeout", message: "No response within 100 ms" };
    });
    const error = await new TauriTransport(bindings)
      .send("ollama", { method: "GET", path: "/api/tags" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ kind: "timeout", providerId: "ollama", retryable: true });

    const { bindings: denied } = fakeBindings(async () => {
      throw "Command provider_request not allowed by ACL";
    });
    const ipc = await new TauriTransport(denied)
      .send("ollama", { method: "GET", path: "/api/tags" })
      .catch((e: unknown) => e);
    expect(ipc).toMatchObject({ kind: "not_configured", retryable: false });
  });

  it("streams lines through the channel and waits for the end marker", async () => {
    const { bindings, calls } = fakeBindings(async (_command, _args, emit) => {
      emit({ type: "line", line: '{"message":{"content":"Hel"},"done":false}' });
      // The last line and the end marker arrive after the command's result.
      setTimeout(() => {
        emit({ type: "line", line: '{"message":{"content":"lo"},"done":false}' });
        emit({
          type: "line",
          line: '{"model":"gemma3:1b","message":{"content":""},"done":true,"done_reason":"stop","prompt_eval_count":3,"eval_count":2}',
        });
        emit({ type: "end" });
      }, 5);
      return { status: 200, headers: {} };
    });
    const adapter = new OllamaAdapter(
      ProviderConfigSchema.parse({ id: "local", kind: "ollama", label: "L", model: "gemma3:1b" }),
    );
    const partial: string[] = [];
    const result = await completeStreaming(
      adapter,
      new TauriTransport(bindings),
      { system: "s", user: "u", suggestedMaxOutputTokens: 10, outputFormat: "text" },
      (text) => partial.push(text),
    );
    expect(calls[0]?.command).toBe("provider_stream");
    expect(partial).toEqual(["Hel", "Hello"]);
    expect(result.text).toBe("Hello");
  });

  it("returns non-2xx stream bodies whole", async () => {
    const { bindings } = fakeBindings(async () => ({
      status: 404,
      headers: {},
      body: { error: "model 'x' not found" },
    }));
    const lines: string[] = [];
    const response = await new TauriTransport(bindings).stream(
      "local",
      { method: "POST", path: "/api/chat" },
      (l) => lines.push(l),
    );
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "model 'x' not found" });
    expect(lines).toEqual([]);
  });

  it("cancels in Rust when the signal aborts", async () => {
    const controller = new AbortController();
    const { bindings, calls } = fakeBindings((command) => {
      if (command === "provider_cancel") return Promise.resolve(null);
      return new Promise((_resolve, reject) => {
        setTimeout(() => reject({ kind: "cancelled", message: "Request cancelled" }), 5);
        controller.abort();
      });
    });
    const error = await new TauriTransport(bindings)
      .send("local", { method: "POST", path: "/api/chat" }, controller.signal)
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "cancelled" });
    expect(calls.map((c) => c.command)).toEqual(["provider_request", "provider_cancel"]);
    expect(calls[1]?.args).toEqual({ requestId: "req-0" });

    const early = await new TauriTransport(bindings)
      .send("local", { method: "GET", path: "/api/tags" }, controller.signal)
      .catch((e: unknown) => e);
    expect(early).toMatchObject({ kind: "cancelled" });
  });

  it("surfaces an error thrown by the line consumer and cancels the request", async () => {
    const { bindings, calls } = fakeBindings(async (command, _args, emit) => {
      if (command === "provider_cancel") return null;
      emit({ type: "line", line: "bad" });
      throw { kind: "cancelled", message: "Request cancelled" };
    });
    const boom = new ProviderError("server", "local", "error line");
    const error = await new TauriTransport(bindings)
      .stream("local", { method: "POST", path: "/api/chat" }, () => {
        throw boom;
      })
      .catch((e: unknown) => e);
    expect(error).toBe(boom);
    expect(calls.some((c) => c.command === "provider_cancel")).toBe(true);
  });
});
