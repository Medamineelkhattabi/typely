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

| Pipeline                       | French errors | English errors | Correct sentences unchanged | Time per correction (median) |
| ------------------------------ | ------------- | -------------- | --------------------------- | ---------------------------- |
| Rules + LanguageTool, no model | 38/59         | 33/62          | 20/20                       | 0.05 s                       |
| + gemma3:1b (panel default)    | 49/59         | 51/62          | 20/20                       | 1.2 s                        |
| + gemma3:4b ("Check again")    | 50/59         | 54/62          | 20/20                       | 4.7 s                        |

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
