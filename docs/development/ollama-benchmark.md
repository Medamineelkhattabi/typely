# Ollama Integration Benchmark

Date: 2026-11-02. Harness: [`scripts/bench`](../../scripts/bench) (run it yourself with
`node scripts/bench/ollama-bench.ts bench --models <tags>`).

## Setup

| Item            | Value                                                                                          |
| --------------- | ---------------------------------------------------------------------------------------------- |
| Machine         | Intel Core i7-1355U (2 P + 8 E cores, 12 threads), 32 GB RAM, Iris Xe, Windows 11              |
| Power           | **On battery** (63%, Balanced plan): numbers are pessimistic versus AC power                   |
| Background load | Another process (a leftover PowerShell process) was using ~1 core throughout; ~10 GB RAM free  |
| Ollama          | v0.40.7 portable zip (SHA-256 verified), `ollama serve` on 127.0.0.1, no installer, no service |
| Models          | `gemma3:1b` (Q4_K_M, 806 MB), `qwen3.5:2b-q4_K_M` (1.9 GB)                                     |
| Engine settings | hybrid mode, `keep_alive: 0` (unload after every request), `think: false`, compact prompt      |
| Corpus          | 9 cases with known errors: 3 French, 3 English, 3 Arabic (fix, professional, translate)        |

Every request is a **cold start**: load the model → correct → unload. This is the
product's resource policy, so load time is part of every measurement.

**What each metric measures**
- **RAM:** peak working set of `ollama.exe` + its `llama-server.exe` runner.
- **CPU:** that process tree's share of all 12 logical CPUs.
- **Interference:** a background worker runs a fixed ~21 ms CPU task every 100 ms; the figures show how long that task takes during inference. This is a direct measure of how much slower the rest of the machine gets.

## Resource policy verification

| Requirement                                              | Result                                                         |
| -------------------------------------------------------- | -------------------------------------------------------------- |
| No model loaded at application start                     | ✅ `/api/ps` empty at start                                    |
| Listing models ("Test connection") does not load a model | ✅                                                             |
| Inline checks (`engine.check`) never touch the model     | ✅                                                             |
| Model loaded only on explicit `run()`                    | ✅                                                             |
| Model unloaded right after completion                    | ✅ gone from `/api/ps` within 0.05–0.6 s; runner process exits |
| No background inference                                  | ✅ idle server: 83–90 MB, 0–1% CPU                             |
| Unloaded after a timeout or a user cancellation          | ✅ (loading is aborted, no orphaned runner)                    |

## Performance

### Prompt profile (gemma3:1b, CPU)

| Prompt                  | Prompt tokens | Prompt time | Output tokens | Total per correction |
| ----------------------- | ------------- | ----------- | ------------- | -------------------- |
| Full (cloud prompt)     | 694–838       | 13.0–15.1 s | 86–454        | **22–47 s**          |
| Compact (local default) | 210–314       | 3.8–5.9 s   | 47–204        | **9–20 s**           |

### CPU vs integrated GPU (compact prompt, medians over 9 cases)

|                                      | gemma3:1b CPU     | gemma3:1b **iGPU**         | qwen3.5:2b CPU     | qwen3.5:2b iGPU   |
| ------------------------------------ | ----------------- | -------------------------- | ------------------ | ----------------- |
| Time per correction                  | 11.5 s (9.0–19.9) | **6.1 s (5.5–8.3)**        | 23.2 s (12.3–34.5) | 19.2 s (9.7–22.7) |
| Model load                           | 1.8 s             | 2.8 s (first ever: 13.9 s) | 4.1 s              | 4.3 s             |
| Prompt processing                    | 54 tok/s          | **290 tok/s**              | 57 tok/s           | 185 tok/s         |
| Generation                           | 15.2 tok/s        | 20.7 tok/s                 | 10.7 tok/s         | 13.0 tok/s        |
| Peak RAM (working set)               | 1.07 GB           | 1.45 GB                    | 2.21 GB            | 2.94 GB           |
| CPU, average / peak                  | 39% / 53%         | **5% / 10%**               | 37% / 56%          | 5% / 10%          |
| Foreground task, median (idle 21 ms) | 59 ms (2.8×)      | **37 ms (1.7×)**           | 61 ms (2.9×)       | 55 ms (2.6×)      |
| Foreground task, p95 (idle 23–33 ms) | 91 ms             | 75 ms                      | 100 ms             | 98 ms             |
| Unload after completion              | ≤ 76 ms           | ≤ 511 ms                   | ≤ 187 ms           | ≤ 639 ms          |

Ollama disables integrated GPUs by default; set `OLLAMA_IGPU_ENABLE=1` to use the Iris Xe
through Vulkan. iGPU RAM is shared system memory, so the RAM figures are real RAM.

### Other measurements

- **Reasoning ("thinking") left on:** qwen3.5:2b produced 2,297 hidden tokens and took
  **204 s** for one sentence. With `think: false`: 1.8 s. The adapter now always sends `think: false`
  unless `thinking: true` is configured.
- **Temperature:** at Ollama's default (0.8), one of three inputs gave different outputs
  across 4 runs. At 0.2, 4 of 4 runs were identical for every input. The adapter now defaults to 0.2.

## Correction quality (compact prompt, CPU run; iGPU run in brackets where different)

| Case                                                             | gemma3:1b                                     | qwen3.5:2b                                         |
| ---------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------- |
| fr: agreement (acheter→acheté, était→étaient, mûre→mûres)        | ✅ perfect                                    | ✅ perfect [iGPU: missed mûres]                    |
| fr: tech terms (passer→passé, sa→ça, keep build/pipeline/deploy) | ❌ unchanged                                  | ❌ **deleted the second sentence**                 |
| fr: professional rewrite of a chat message                       | ⚠️ barely changed, still "Salut… tu"          | ❌ garbled ("raport", "d'14h", "[DATA]")           |
| en: homophones (Their→They're, tomorow, dont, its, i)            | ❌ **introduced "They's"** [iGPU: ✅ perfect] | ❌ left "Their going"                              |
| en: agreement + URL + "5pm"                                      | ✅                                            | ✅ (but "5pm" → "5 pm" in iGPU run)                |
| en→fr translation                                                | ⚠️ dropped "meeting"                          | ✅ best output                                     |
| ar: hamza/taa marbuta                                            | ✅ (fixes mostly from local rules)            | ✅ (same)                                          |
| ar: punctuation + ارسال→إرسال                                    | ⚠️ only the local-rule fixes                  | ❌ **returned our hint block instead of the text** |
| ar: professional (dialect → formal)                              | ❌ **answered in English**                    | ❌ meaningless Arabic                              |

Guards caught most bad outputs: `language_changed` on both language switches,
`excessive_changes` on the deleted sentence and the hint-block echo, and `no_changes` when
nothing was fixed. They also produced **false positives**: `excessive_changes` fires on
short sentences that legitimately contain many errors, and on Arabic hamza fixes.

**Assessment.** At 1–2 B parameters, local models are useful only for **simple
corrections in English and French**, and only together with the deterministic layer.
Professional rewriting, Arabic correction beyond the local rules, and anything that needs
judgement are not reliable enough to ship. qwen3.5:2b is twice as slow, uses twice the
RAM, and fails more dangerously (deletions, prompt echo) despite better translation.

## Failure handling (real server)

| Scenario                           | Result                                                                        |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| Ollama not running                 | `provider_failed`: "connection refused — is the server running?" after 0.55 s |
| Model not installed                | `provider_failed`: HTTP 404 "model … not found", 26 ms, no retry              |
| Timeout (300 ms)                   | retried once, then `provider_failed` (timeout), 1.1 s; nothing left loaded    |
| User cancels after 1.5 s           | `cancelled` at 1.50 s; loading aborted; CPU back to idle                      |
| Broken provider → working provider | fell back automatically, `provider_fallback` warning, result OK               |

## Problems discovered

Fixed during this validation:
1. Reasoning models think by default → 100× slower. **Fixed:** `think: false` by default.
2. The cloud-sized prompt costs ~13 s of prompt processing on this CPU. **Fixed:** compact prompt profile for local endpoints.
3. Ollama keeps models loaded for 5 minutes by default. **Fixed:** `keep_alive: 0` by default.
4. Ollama's default temperature (0.8) gives non-repeatable corrections. **Fixed:** 0.2 by default.
5. Small models sometimes wrap the answer in our delimiter tags. **Fixed:** the engine strips them.
6. Connection errors read "fetch failed ()". **Fixed:** the real cause is reported (`ECONNREFUSED` etc.).
7. The benchmark sampler missed the `llama-server.exe` runner. **Fixed** in the harness.

Open:
8. Small models fail on rewriting, Arabic and professional tone (see above).
9. `excessive_changes` false positives on short, error-dense text and on Arabic.
10. qwen3.5 copied the "Automated checks flagged" hint block into its answer. Consider omitting hints, or moving them into the system message, in the compact profile.
11. By default Ollama has cloud features on (`Ollama cloud disabled: false`) and schedules a "model recommendations" fetch from ollama.com. Launch with `OLLAMA_NO_CLOUD=1`. The recommendations fetch has no documented switch.
12. The Ollama Windows zip is 1.58 GB, mostly CUDA libraries that are useless on Iris Xe. Typely should detect an existing Ollama, not bundle it.
13. The first-ever iGPU load took 13.9 s (one-time shader compilation).
14. Measured on battery with a stray background process using one core. Re-measure on AC power with that process stopped.

## Recommended configuration

```json
{
  "id": "local",
  "kind": "ollama",
  "label": "Ollama (local)",
  "model": "gemma3:1b",
  "base_url": "http://127.0.0.1:11434",
  "keep_alive_seconds": 0,
  "thinking": false,
  "temperature": 0.2,
  "prompt_profile": "compact",
  "timeout_ms": 60000
}
```

The last five fields are now the adapter's defaults; they are listed only to make the
policy explicit. Server environment: `OLLAMA_HOST=127.0.0.1:11434`, `OLLAMA_IGPU_ENABLE=1`,
`OLLAMA_NO_CLOUD=1`.

- **Default local model:** `gemma3:1b` on the iGPU: ~6 s per correction, ~1.4 GB RAM only while correcting, ~5% CPU, foreground slowdown ~1.7× during those seconds.
- **Scope with this model:** `fix` in hybrid mode for English and French. Mark the other operations and Arabic AI correction "experimental" in the UI, with the guards' warnings shown before _Replace_.
- **Not recommended:** qwen3.5:2b (slower, heavier, fails dangerously); any reasoning mode; full prompt on local models.
- **Next validation:** a 4 B-class model (`gemma3:4b`, 3.4 GB, or `qwen3.5:4b`, 3.3 GB) on the iGPU, to find out whether rewriting and Arabic become reliable at an acceptable latency. It needs your approval for the download.
