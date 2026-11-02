import { ProviderConfigSchema } from "@typely/schemas";
import { describe, expect, it, vi } from "vitest";
import {
  AllProvidersFailedError,
  createAdapter,
  type ProviderAdapter,
  ProviderChain,
  ProviderError,
} from "../src/index.ts";

const adapter = (id: string): ProviderAdapter =>
  createAdapter(ProviderConfigSchema.parse({ id, kind: "ollama", label: id, model: "m" }));
const fail = (kind: ProviderError["kind"], id: string, retryAfterMs?: number) =>
  new ProviderError(kind, id, kind, retryAfterMs === undefined ? {} : { retryAfterMs });

describe("ProviderChain", () => {
  const sleep = vi.fn(async () => {});

  it("returns the first success", async () => {
    const chain = new ProviderChain([adapter("a"), adapter("b")], { sleep });
    const result = await chain.run(async (a) => a.config.id);
    expect(result.value).toBe("a");
    expect(result.attempts).toEqual([
      expect.objectContaining({ providerId: "a", outcome: "success" }),
    ]);
  });

  it("retries retryable errors with backoff, honouring Retry-After", async () => {
    const delays: number[] = [];
    const chain = new ProviderChain([adapter("a")], {
      maxRetries: 2,
      baseDelayMs: 100,
      sleep: async (ms) => {
        delays.push(ms);
      },
    });
    let calls = 0;
    const result = await chain.run(async (a) => {
      calls++;
      if (calls === 1) throw fail("server", a.config.id);
      if (calls === 2) throw fail("rate_limit", a.config.id, 1500);
      return "ok";
    });
    expect(result.value).toBe("ok");
    expect(delays).toEqual([100, 1500]);
    expect(result.attempts.map((x) => x.outcome)).toEqual(["error", "error", "success"]);
  });

  it("falls back to the next provider on non-retryable errors without retrying", async () => {
    const chain = new ProviderChain([adapter("a"), adapter("b")], { maxRetries: 3, sleep });
    const seen: string[] = [];
    const result = await chain.run(async (a) => {
      seen.push(a.config.id);
      if (a.config.id === "a") throw fail("auth", "a");
      return "from-b";
    });
    expect(seen).toEqual(["a", "b"]);
    expect(result.adapter.config.id).toBe("b");
  });

  it("aggregates errors when every provider fails", async () => {
    const chain = new ProviderChain([adapter("a"), adapter("b")], { maxRetries: 0, sleep });
    const error = await chain
      .run(async (a) => Promise.reject(fail("invalid_response", a.config.id)))
      .catch((e) => e);
    expect(error).toBeInstanceOf(AllProvidersFailedError);
    expect((error as AllProvidersFailedError).errors.map((e) => e.providerId)).toEqual(["a", "b"]);
  });

  it("stops immediately on cancellation", async () => {
    const chain = new ProviderChain([adapter("a"), adapter("b")], { sleep });
    const task = vi.fn(async (a: ProviderAdapter) =>
      Promise.reject(fail("cancelled", a.config.id)),
    );
    await expect(chain.run(task)).rejects.toMatchObject({ kind: "cancelled" });
    expect(task).toHaveBeenCalledTimes(1);

    const controller = new AbortController();
    controller.abort();
    await expect(chain.run(async () => "x", controller.signal)).rejects.toMatchObject({
      kind: "cancelled",
    });
  });

  it("does not disguise programming errors as provider failures", async () => {
    const chain = new ProviderChain([adapter("a"), adapter("b")], { sleep });
    await expect(chain.run(async () => Promise.reject(new TypeError("bug")))).rejects.toThrow(
      TypeError,
    );
  });
});
