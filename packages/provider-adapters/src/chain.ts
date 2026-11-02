import { AllProvidersFailedError, ProviderError } from "./errors.ts";
import type { ProviderAdapter } from "./types.ts";

export interface AttemptRecord {
  providerId: string;
  outcome: "success" | "error";
  errorKind?: ProviderError["kind"];
  durationMs: number;
}

export interface ChainResult<T> {
  value: T;
  adapter: ProviderAdapter;
  attempts: AttemptRecord[];
}

export interface ProviderChainOptions {
  /** Retries per provider for retryable errors (rate limit, server, network, timeout). */
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Injectable for tests. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
}

/**
 * Runs a task against providers in order. Retryable errors are retried on the same
 * provider with exponential backoff; any other failure falls through to the next
 * provider. Cancellation stops immediately.
 */
export class ProviderChain {
  readonly adapters: readonly ProviderAdapter[];
  readonly #maxRetries: number;
  readonly #baseDelayMs: number;
  readonly #maxDelayMs: number;
  readonly #sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly #now: () => number;

  constructor(adapters: readonly ProviderAdapter[], options: ProviderChainOptions = {}) {
    this.adapters = adapters;
    this.#maxRetries = options.maxRetries ?? 1;
    this.#baseDelayMs = options.baseDelayMs ?? 500;
    this.#maxDelayMs = options.maxDelayMs ?? 8_000;
    this.#sleep = options.sleep ?? abortableSleep;
    this.#now = options.now ?? (() => performance.now());
  }

  async run<T>(
    task: (adapter: ProviderAdapter, signal?: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<ChainResult<T>> {
    const attempts: AttemptRecord[] = [];
    const errors: ProviderError[] = [];

    for (const adapter of this.adapters) {
      for (let attempt = 0; attempt <= this.#maxRetries; attempt++) {
        throwIfCancelled(signal, adapter.config.id);
        const started = this.#now();
        try {
          const value = await task(adapter, signal);
          attempts.push({
            providerId: adapter.config.id,
            outcome: "success",
            durationMs: this.#now() - started,
          });
          return { value, adapter, attempts };
        } catch (error) {
          const providerError = toProviderError(error, adapter.config.id, signal);
          attempts.push({
            providerId: adapter.config.id,
            outcome: "error",
            errorKind: providerError.kind,
            durationMs: this.#now() - started,
          });
          if (providerError.kind === "cancelled") throw providerError;
          if (!providerError.retryable || attempt === this.#maxRetries) {
            errors.push(providerError);
            break;
          }
          const backoff = Math.min(this.#maxDelayMs, this.#baseDelayMs * 2 ** attempt);
          await this.#sleep(
            Math.min(this.#maxDelayMs, providerError.retryAfterMs ?? backoff),
            signal,
          );
        }
      }
    }
    throw new AllProvidersFailedError(errors);
  }
}

function toProviderError(error: unknown, providerId: string, signal?: AbortSignal): ProviderError {
  if (error instanceof ProviderError) return error;
  if (signal?.aborted) return new ProviderError("cancelled", providerId, "Request cancelled");
  // Programming errors must not be disguised as provider failures.
  throw error;
}

function throwIfCancelled(signal: AbortSignal | undefined, providerId: string): void {
  if (signal?.aborted) throw new ProviderError("cancelled", providerId, "Request cancelled");
}

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ProviderError("cancelled", "chain", "Request cancelled"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ProviderError("cancelled", "chain", "Request cancelled"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
