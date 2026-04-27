# Security policy

Even Realities G2 smart-glasses plugin (this repo) + a personal
Cloudflare Worker the user deploys for the audio + LLM pipeline.

## Reporting a vulnerability

This is a personal-use project — no public bug-bounty program. If you
spot a real security issue (auth bypass on the Worker, credential leak,
arbitrary code execution from a crafted transcript, etc.), open a
private GitHub security advisory on this repo OR email the maintainer
directly. Do not file public issues for security findings.

## Threat model

What this app does NOT trust:
- The transcribed audio content — treated as user-controlled input;
  never `eval`'d, never used as a key into anything privileged.
- Worker URL + bearer token entered in phone settings — stored in
  `localStorage` / Even Hub bridge storage; never logged.
- LLM responses — rendered as plain text, never executed.

What this app DOES trust:
- The deployed personal Cloudflare Worker authenticated via the bearer
  token. The Worker is the user's own (template at `worker-template/`);
  if compromised, that's a user-side problem.
- The Even Realities companion app + WKWebView host. We assume the
  host's WebView sandbox is intact.

## Known limitations

- **Bearer token is in `localStorage` (or bridge storage).** WKWebView's
  storage is sandboxed per-app; a compromised WebView could leak it.
  Mitigation: rotate the Worker's `SHARED_SECRET` periodically.
- **The Worker accepts any request with the right bearer.** No per-user
  rate limit. A leaked token = unlimited use of your Deepgram/LLM quota.
  Mitigation: rotate immediately if leaked.
- **No request signing.** Requests are bearer-only, not HMAC-signed.
  In-flight tampering is possible but only by an attacker with TLS
  intercept (highly unlikely on a phone WebView).
- **The `/transcribe` 405 response includes received-method + headers +
  cf-ray + cf-country** for diagnostic purposes. This is intentional
  (debugging convenience) but technically info-discloses the Worker's
  Cloudflare deployment region. Acceptable for personal-use.

## Out of scope

- Side-channel attacks on the BLE link to the glasses
- Physical attacks on the glasses themselves
- Compromise of the Even Realities companion app
- Compromise of Cloudflare Workers / Deepgram / Anthropic / OpenAI
  infrastructure
