import { Worker } from "node:worker_threads";

/**
 * Measures how much a background workload slows down "normal" foreground work: a worker
 * repeatedly runs a fixed CPU task (~20 ms at idle) and records how long each run takes.
 * Comparing durations during inference with an idle baseline gives a direct, user-centred
 * interference figure that CPU percentages alone do not.
 */
const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
function task(iterations) {
  let x = 0;
  for (let i = 0; i < iterations; i++) x = (x * 1664525 + 1013904223) % 4294967296;
  return x;
}
// Calibrate to ~20 ms on an idle machine.
let iterations = 1e6;
for (;;) {
  const t = performance.now();
  task(iterations);
  const d = performance.now() - t;
  if (d >= 18) { iterations = Math.round(iterations * 20 / d); break; }
  iterations *= 2;
}
parentPort.postMessage({ type: "ready" });
setInterval(() => {
  const t = performance.now();
  task(iterations);
  parentPort.postMessage({ type: "sample", at: Date.now(), ms: performance.now() - t });
}, workerData.intervalMs);
`;

export interface ProbeSample {
  at: number;
  ms: number;
}

export class InterferenceProbe {
  readonly samples: ProbeSample[] = [];
  #worker: Worker | undefined;

  start(intervalMs = 100): Promise<void> {
    this.#worker = new Worker(WORKER_SOURCE, { eval: true, workerData: { intervalMs } });
    return new Promise((resolve) => {
      this.#worker?.on("message", (m: { type: string; at?: number; ms?: number }) => {
        if (m.type === "ready") resolve();
        else if (m.at !== undefined && m.ms !== undefined)
          this.samples.push({ at: m.at, ms: m.ms });
      });
    });
  }

  between(from: number, to: number): number[] {
    return this.samples.filter((s) => s.at >= from && s.at <= to).map((s) => s.ms);
  }

  async stop(): Promise<void> {
    await this.#worker?.terminate();
  }
}

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? Number.NaN;
}
