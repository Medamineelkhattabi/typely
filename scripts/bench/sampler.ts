import { type ChildProcess, spawn } from "node:child_process";
import { createInterface } from "node:readline";

export interface ProcessSample {
  /** ms since sampler start. */
  t: number;
  /** Sum of working sets of all matching processes, bytes. */
  workingSet: number;
  /** Sum of private bytes (committed memory), bytes. */
  privateBytes: number;
  /** Sum of total CPU time, ms. */
  cpuMs: number;
  processes: number;
}

/**
 * Samples Ollama processes (server + model runner) from a single long-lived PowerShell
 * loop, so sampling does not spawn a process per tick and does not skew the CPU numbers
 * of the processes being measured.
 */
export class ProcessSampler {
  readonly samples: ProcessSample[] = [];
  #child: ChildProcess | undefined;

  start(namePattern = "ollama*", intervalMs = 200): Promise<void> {
    const script = `
      $sw = [Diagnostics.Stopwatch]::StartNew()
      while ($true) {
        $p = @(Get-Process -Name '${namePattern}' -ErrorAction SilentlyContinue)
        $ws = ($p | Measure-Object WorkingSet64 -Sum).Sum
        $pb = ($p | Measure-Object PrivateMemorySize64 -Sum).Sum
        $cpu = ($p | ForEach-Object { $_.TotalProcessorTime.TotalMilliseconds } | Measure-Object -Sum).Sum
        [Console]::Out.WriteLine("$($sw.ElapsedMilliseconds),$([long]$ws),$([long]$pb),$([long]$cpu),$($p.Count)")
        [Console]::Out.Flush()
        Start-Sleep -Milliseconds ${intervalMs}
      }`;
    this.#child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      stdio: ["ignore", "pipe", "inherit"],
      windowsHide: true,
    });
    const lines = createInterface({ input: this.#child.stdout as NodeJS.ReadableStream });
    return new Promise((resolve) => {
      lines.on("line", (line) => {
        const [t, ws, pb, cpu, count] = line.split(",").map(Number);
        if (t === undefined || Number.isNaN(t)) return;
        this.samples.push({
          t,
          workingSet: ws ?? 0,
          privateBytes: pb ?? 0,
          cpuMs: cpu ?? 0,
          processes: count ?? 0,
        });
        if (this.samples.length === 1) resolve();
      });
    });
  }

  /** Index of the latest sample; use with `window()` to analyse a time range. */
  mark(): number {
    return this.samples.length;
  }

  window(from: number, to = this.samples.length): ProcessSample[] {
    return this.samples.slice(Math.max(0, from - 1), to);
  }

  stop(): void {
    this.#child?.kill();
  }
}

export interface WindowStats {
  peakWorkingSetMB: number;
  peakPrivateMB: number;
  /** Average share of the whole machine (all logical CPUs), %. */
  avgCpuPercent: number;
  /** Highest 1-interval share of the whole machine, %. */
  peakCpuPercent: number;
}

export function summarise(window: readonly ProcessSample[], logicalCpus: number): WindowStats {
  let peakWs = 0;
  let peakPb = 0;
  let peakCpu = 0;
  for (let i = 0; i < window.length; i++) {
    const s = window[i];
    if (s === undefined) continue;
    peakWs = Math.max(peakWs, s.workingSet);
    peakPb = Math.max(peakPb, s.privateBytes);
    const prev = window[i - 1];
    if (prev !== undefined && s.t > prev.t) {
      // CPU time can drop when a runner process exits; ignore negative deltas.
      const delta = Math.max(0, s.cpuMs - prev.cpuMs);
      peakCpu = Math.max(peakCpu, (delta / ((s.t - prev.t) * logicalCpus)) * 100);
    }
  }
  const first = window[0];
  const last = window.at(-1);
  let avgCpu = 0;
  if (first !== undefined && last !== undefined && last.t > first.t) {
    let cpu = 0;
    for (let i = 1; i < window.length; i++) {
      const a = window[i - 1];
      const b = window[i];
      if (a !== undefined && b !== undefined) cpu += Math.max(0, b.cpuMs - a.cpuMs);
    }
    avgCpu = (cpu / ((last.t - first.t) * logicalCpus)) * 100;
  }
  return {
    peakWorkingSetMB: Math.round(peakWs / 1048576),
    peakPrivateMB: Math.round(peakPb / 1048576),
    avgCpuPercent: Math.round(avgCpu),
    peakCpuPercent: Math.round(Math.min(100, peakCpu)),
  };
}
