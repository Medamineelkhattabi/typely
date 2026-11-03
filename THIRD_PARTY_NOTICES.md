# Third-party notices

Typely includes the following third-party material, which stays under its own licence and
is not covered by Typely's [LICENSE](LICENSE).

## SCOWL English word list

- **Used for:** the local English spell checker
  ([`packages/correction-engine/data/en-words.txt`](packages/correction-engine/data/en-words.txt)),
  bundled with the desktop app.
- **Source:** SCOWL Hunspell dictionaries `en_US` and `en_GB-ise`, release 2026.02.25,
  <https://github.com/en-wl/wordlist>. Expanded and front-coded by
  [`scripts/build-wordlist.ts`](scripts/build-wordlist.ts), so the bundled file is a
  modified version.
- **Licence:** permissive (Kevin Atkinson's SCOWL licence), plus the BSD licence of Geoff
  Kuenning's affix file used to expand it. The full notices are in
  [`en-words.LICENSE`](packages/correction-engine/data/en-words.LICENSE).

> Copyright 2000-2026 by Kevin Atkinson. Copyright 1993, Geoff Kuenning, Granada Hills, CA.

## LanguageTool and Eclipse Temurin (optional, not redistributed)

The optional grammar checker runs LanguageTool 6.6 (<https://languagetool.org>, GNU LGPL 2.1)
on an Eclipse Temurin Java runtime (GNU GPL v2 with the Classpath Exception). Both are
downloaded separately by the user (see the setup guide) and run as a separate local process;
neither is included in this repository or linked into Typely.

## Windows spell checker

Spell checking for other languages uses the spell checker built into Windows (the
`ISpellCheckerFactory` API) for the languages installed on the user's PC. Nothing from it is
redistributed.

## Open-source dependencies

npm and Cargo dependencies are listed with their licences in `package-lock.json` and
`Cargo.lock`, and keep their own licences.
