# Security policy

Typely handles text people write and API keys for AI providers, so security reports are
taken seriously.

## Reporting a vulnerability

Please **do not open a public issue**. Report it privately through GitHub:
**Security → Report a vulnerability** on this repository.

Include what you found, how to reproduce it, and the impact you expect. You will get an
answer within a few days, and credit in the fix if you want it.

## Scope

Especially relevant:

- API keys leaving the Windows Credential Manager, reaching a webview, or going to a host
  other than the one they were entered for
- Text sent to a cloud provider without the user's consent
- Password or other sensitive fields being read
- Clipboard content lost, leaked or not restored
- Text pasted into a different window or field than the one it came from
- Prompt injection that makes a correction act on instructions in the text

The design and its known limitations are described in the
[threat model](docs/security/threat-model.md).

## Supported versions

Typely is pre-release. Fixes go to the `main` branch.
