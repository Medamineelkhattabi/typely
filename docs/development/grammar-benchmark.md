# Grammar test set: results

Date: 2026-11-03. Test set: [`scripts/bench/grammar-corpus.ts`](../../scripts/bench/grammar-corpus.ts),
121 sentences with one known error each (59 French, 62 English) and 20 correct sentences
that must come back unchanged. Runner: [`scripts/bench/grammar-suite.ts`](../../scripts/bench/grammar-suite.ts)
(same engine as the panel: local rules, word list, LanguageTool 6.6, then the model).

```bash
node scripts/bench/grammar-suite.ts --lt http://127.0.0.1:18082 --model gemma3:1b
```

What it covers:
- **French:**
  - conjugation and subjunctive;
  - past participles (avoir, être, pronominal);
  - infinitive after "aller"/"falloir";
  - tense agreement ("si j'aurais");
  - noun and adjective agreement;
  - 15 homophone pairs (a/à, et/est, ou/où, son/sont, on/ont, ce/se, c'est/s'est, quand/quant…);
  - elision;
  - word order ("une grande très maison", "où est-il" in an indirect question).
- **English:**
  - subject-verb agreement;
  - tenses and irregular verbs;
  - articles and plurals;
  - comparatives and pronouns;
  - confused words (their/they're, its/it's, then/than, lose/loose, affect/effect…);
  - prepositions;
  - double negatives;
  - word order (questions, adverbs, adjectives).

## Results

| Pipeline                                       | French errors | English errors | Correct sentences unchanged | Time per correction (median) |
| ---------------------------------------------- | ------------- | -------------- | --------------------------- | ---------------------------- |
| Rules + LanguageTool, no model                 | 38/59         | 33/62          | 20/20                       | 0.05 s                       |
| + gemma3:1b (panel default)                    | 49/59         | 51/62          | 20/20                       | 1.2 s                        |
| + gemma3:4b ("Check again")                    | 50/59         | 54/62          | 20/20                       | 4.7 s                        |
| + Groq `openai/gpt-oss-20b` (cloud, free tier) | 55/59         | 60/62          | 18/20                       | 2.2 s (90 % under 5.7 s)     |

Groq changed 2 of the 20 correct sentences:
- "Je te retrouve" became "Je te retrouverai": a tense change, not an error.
- "Elle s'est rendu compte de son erreur" became "s'est rendue compte de sa erreur", which
  adds two errors.

Both are now handled by two fixes:
- **A final pass:** LanguageTool checks the model's output and applies its sure fixes,
  which gives "sa erreur" → "son erreur".
- **A rule for "se rendre compte":** the participle never agrees (`FR_RENDU_COMPTE`).

A second Groq run gave the same score on the 91 sentences it answered (87 and 85; the
model's answers vary from run to run). It then hit Groq's free daily limit (see below).

### French speed: LanguageTool's pipeline cache

LanguageTool rebuilt its rule pipeline for every request, so each French check took 1.2–5.5 s
whatever the length, and a correction runs at least two. Typely now starts it with
`pipelineCaching=true` (ADR-020). Measured 2026-11-04 on 8 French sentences with Groq
`openai/gpt-oss-20b`, both servers side by side:

| LanguageTool       | Fixed | Median time per correction |
| ------------------ | ----- | -------------------------- |
| No pipeline cache  | 8/8   | 5.4 s                      |
| Pipeline cache on  | 8/8   | 1.3 s                      |

A single French check drops from 3.2–5.5 s to ~0.1 s, for about 75 MB more while the server
runs. English checks were already ~0.1 s.

### Cloud models: free tiers

**Groq.** One correction costs about 1,100–1,600 tokens with the full prompt. The free tier
allows 200,000 tokens per day for `openai/gpt-oss-20b`, so about 130–180 corrections a day
on that model. Each model has its own allowance (`openai/gpt-oss-120b`, `qwen/qwen3.8-27b`).
After the limit, Groq answers 429 until the next window.

**OpenRouter.** Its free models (`:free`) allow 1,000 requests a day on this account. They
are shared by everyone, so several were saturated or refused during the test. Measured on
12 of the hardest sentences (10 errors, 2 correct):

| Model                                                | Answered | Errors fixed | Correct unchanged | Median time |
| ---------------------------------------------------- | -------- | ------------ | ----------------- | ----------- |
| Groq `openai/gpt-oss-20b` (for comparison)           | 12/12    | 8/10         | 1/2               | 3.2 s       |
| `nvidia/nemotron-3.5-lightning:free`                 | 12/12    | 10/10        | 2/2               | 22.7 s      |
| `nvidia/nemotron-3-ultra-550b-a55b:free`             | 12/12    | 10/10        | 1/2               | 10.3 s      |
| `openrouter/free` (OpenRouter picks the model)       | 12/12    | 9/10         | 2/2               | 9.7 s       |
| `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` | 12/12    | 9/10         | 1/2               | 5.8 s       |
| `dots-studio/dots-3-note-preview:free`               | 11/12    | 9/10         | 1/2               | 14.2 s      |
| `cohere/north-mini-code:free`                        | 12/12    | 8/10         | 2/2               | 9.6 s       |
| `nvidia/nemotron-3.5-super-vl:free`                  | 12/12    | 8/10         | 1/2               | 6.3 s       |
| gemma3:4b, local (for comparison)                    | 12/12    | 6/10         | 2/2               | 5.0 s       |
| gemma3:1b, local (for comparison)                    | 12/12    | 4/10         | 2/2               | 2.0 s       |

Six other free models did not work:
- **Saturated (429 every time):** both Gemma 4 models, plus Liquid LFM and Xing 4.0, which
  answered once each.
- **Server errors:** Flint.
- **Refused outside certain apps:** both Inkling models.

Nemotron content-safety is not a writing model. On OpenRouter, "correct unchanged" failures
were all a comma made into a semicolon or a full stop.

Before the changes below, the same set gave 85/141 without a model and 109/141 with
gemma3:1b. That run changed 3 correct sentences: "tu" became "vous", "9 h" became "9h" and
apostrophes were swapped.

## What the test set changed

- **French subjunctive rule** (`FR_SUBJONCTIF`): "Il faut que tu vien/viens" → "viennes",
  "bien qu'il est" → "soit". LanguageTool only fixed the person ("viens"), and both models
  kept the indicative.
- **More LanguageTool fixes applied automatically**, each measured on the test set:
  - elision ("Je ai" → "J'ai");
  - English collocations ("married with" → "married to", "discuss about it" → "discuss it");
  - non-standard plurals ("informations");
  - "Elle et partie" → "est";
  - "goes always" → "always goes".
- **Guards against wrong automatic fixes:**
  - **Rule pointing at word order:** a fix is held back when the same rule also flags the
    next word without a fix. "une grande très maison" was becoming "une grande vraiment
    maison".
  - **Two false-positive rule types:** "A transport…" → "Transport" and "hand-written" →
    "handwritten", found by re-checking the repository's own docs, are now suggestions
    only ([`lt-precision.ts`](../../scripts/bench/lt-precision.ts)).
- **The model's output is checked against the input:**
  - it keeps the writer's apostrophes;
  - it cannot switch between "tu" and "vous";
  - it cannot change spacing only;
  - it cannot undo a fix the rules were sure of ("ce point-là").
- **The model sees the real choices:** when LanguageTool offers several candidates ("Ils
  mange" → "mangent" or "Il mange"), they are passed to the model as hints.
- **Suggestions are re-checked on the final text:** "arrivés → arrivé | arrivée" no longer
  shows once "Mes amis est" has become "sont". LanguageTool's spelling guesses for unknown
  words ("npm" → NPM | PM) are not listed.
- **Language detection:** "car" no longer counts as French ("He buyed a new car" was read
  as French).

## What still fails

- **Word order:** "I yesterday went", "a red big car", "Elle chante bien très", "Je vais
  demain au cinéma aller". The 1B model rarely repairs these; the 4B model repairs some.
- **Tense from context:** "I seen him yesterday" becomes "I have seen him yesterday" (should
  be "saw"); "Hier, je mange" stays.
- **Choices that change the meaning:** "Les animal du zoo sont calmes" becomes "L'animal du
  zoo est calme" (singular) instead of "Les animaux"; "The childs are playing" becomes "The
  child is playing". The sentence is then correct, but says something else.
- **Rarer rules:**
  - "se sont parlé" (no agreement with an indirect object);
  - "malgré que" → "bien que";
  - "borrow" vs "lend";
  - "told that" vs "said that".

The automatic layer is precise: across both runs, it changed none of the 20 correct
sentences. What it does not fix is either listed under "To check" in the panel or left to
the model.
