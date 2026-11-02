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
13. The first-ever iGPU load is slow (gemma3:1b 13.9 s, gemma3:4b 21 s; one-time shader compilation). Phase 2 should explain it on first use.
14. The first run was on battery. The gemma3:4b run was on AC power, which made gemma3:1b ~20% faster (4.8 s vs 6.1 s). The stray process using one core was present in both runs.

## gemma3:4b validation (2026-11-03)

**Conditions.**
- **Hardware and power:** the same laptop, now **on AC power** (battery charging from 8%), with the stray process still using ~1 core.
- **Server:** iGPU on, `OLLAMA_NO_CLOUD=1` (log confirms `Ollama cloud disabled: true`).
- **Models:** `gemma3:4b` (Q4_K_M, 3.35 GB download), with gemma3:1b re-run in the same session for a fair comparison.
- **Method:** one discarded warm-up request per model (first-ever 4B load: 21 s), then the same 9 cases. Temperature was 0.2, the new default.

### Performance (iGPU, medians over 9 cases)

|                                  | gemma3:1b           | gemma3:4b          |
| -------------------------------- | ------------------- | ------------------ |
| Time per correction              | **4.8 s** (4.5–5.8) | 17.1 s (12.6–26.9) |
| Model load                       | 2.2 s               | 4.6 s              |
| Prompt processing                | 451 tok/s           | 109 tok/s          |
| Generation                       | 25.9 tok/s          | 8.4 tok/s          |
| Output tokens                    | 52                  | 90                 |
| Peak RAM (working set / private) | 1.38 / 1.48 GB      | **4.48 / 4.77 GB** |
| CPU, average / peak              | 5% / 10%            | 4% / 11%           |
| Unload after completion          | ≤ 0.3 s             | ≤ 0.8 s            |
| Idle server between requests     | 41–44 MB, 0% CPU    | same               |

Interference could not be compared reliably in this run. The idle baseline of the
foreground task drifted from 18.6 ms before the run to 34 ms after it, probably from
battery charging and heat, so the order of the runs biases the result. The measured
range was a 1.6–2.6× slowdown during inference, in line with the earlier run.

Generation dominates the 4B's time. Cases asked for no explanations (translation,
professional) produced 45–65 tokens and finished in 12.6–14.8 s. Corrections with up to 3
explanations produced 79–169 tokens and took 15.6–26.9 s. Dropping model-written
explanations for `fix` (the UI already highlights changes from its own diff) would bring
the 4B to roughly 11–14 s. This is an estimate from those cases, not yet measured.

### Quality

| Case                                | gemma3:1b                  | gemma3:4b                                                                           |
| ----------------------------------- | -------------------------- | ----------------------------------------------------------------------------------- |
| fr: agreement                       | ✅ perfect                 | ✅ perfect                                                                          |
| fr: tech terms                      | ❌ unchanged               | ⚠️ fixed "passé", missed "sa→ça"; technical terms kept                              |
| fr: professional                    | ⚠️ barely changed          | ⚠️ well punctuated and polite ("s'il te plaît"), but keeps the informal "Salut… tu" |
| en: homophones                      | ✅                         | ✅                                                                                  |
| en: agreement + URL                 | ✅                         | ⚠️ fixed "their", missed "have→has pushed"                                          |
| en→fr translation                   | ⚠️ dropped "meeting"       | ✅ complete and natural                                                             |
| ar: hamza/taa marbuta               | ✅ local-rule fixes only   | ✅ **all fixed, including جميلًا** (the only model to fix the predicate case)         |
| ar: punctuation + إرسال             | ⚠️ local-rule fixes only   | ✅ all fixed                                                                        |
| ar: professional (dialect → formal) | ❌ **answered in English** | ✅ correct formal Arabic, same meaning                                              |

**gemma3:4b is the first model with no damaging failure**: no language switch, no
deleted content, no echoed prompt. It is clearly better at Arabic and translation. It
still misses some errors and does not shift register on its own (a "professional"
request keeps "tu"), so the guards and the user's review before _Replace_ stay necessary.
The `excessive_changes` false positive appeared again on two correct outputs (English
homophones, Arabic hamza).

### Trade-off

- **gemma3:4b:** about 3.5× slower and 3× the RAM of gemma3:1b, held only while it runs. 4.5 GB was comfortable with ~10.6 GB free on this 32 GB machine; on a 16 GB machine with a browser and Teams open it would not be.
- **gemma3:1b:** fast enough to feel interactive. Too unreliable outside English/French fixes.

## Recommended configuration

Use both models, each where it is good, through the engine's existing per-operation
routing. No architecture change is needed:

```json
{
  "providers": [
    { "id": "local-fast", "kind": "ollama", "label": "Ollama · fast", "model": "gemma3:1b" },
    {
      "id": "local-quality",
      "kind": "ollama",
      "label": "Ollama · quality",
      "model": "gemma3:4b",
      "timeout_ms": 90000
    }
  ],
  "provider_order": ["local-quality", "local-fast"],
  "operation_providers": { "fix": "local-fast" }
}
```

- `fix` uses gemma3:1b: ~5 s, 1.4 GB.
- Rewrite, professional, concise, friendly, clarity, translate and prompt use gemma3:4b: ~13–17 s, 4.5 GB.
- Each falls back to the other model if one fails.
- The adapter defaults apply to both: unload after every request, no reasoning, temperature 0.2, compact prompt.
- Server environment: `OLLAMA_HOST=127.0.0.1:11434`, `OLLAMA_IGPU_ENABLE=1`, `OLLAMA_NO_CLOUD=1`.
- **Arabic:** route Arabic corrections to gemma3:4b as well, because the 1B adds nothing beyond the local rules for Arabic. This needs language-aware routing, which the engine does not have yet (roadmap). Until then, Arabic-first users should set `"fix": "local-quality"`.
- **Low-RAM machines (≤ 16 GB):** offer gemma3:1b only, and mark the other operations experimental.
- **Not recommended:** qwen3.5:2b; any reasoning mode; the full prompt on local models.
- **UX implications for Phase 2:** show progress and a Cancel button for the 4B; show the guards' warnings before _Replace_; never preload.
