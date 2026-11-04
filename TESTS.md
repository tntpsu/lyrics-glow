# TESTS — coverage matrix (lyrics-glow v0.4.0)

Last updated: 2026-11-03 (v0.4.0 — SDK 0.0.16, contextual menu, SDK floor guard).

Full taxonomy + discipline: `~/.claude/skills/coverage-matrix/SKILL.md`. Empty cells block the next ship. `/ship-app` blocks if this file has unfilled cells.

## Use case × failure mode

| Use case | Happy | No track playing | LRCLIB miss | Bridge unreachable | Drift > 2s | Track change |
|---|---|---|---|---|---|---|
| Manual paste track → fetch lyrics | e2e | manual:hw | manual:hw | n/a | n/a | n/a |
| Auto-detect Mac-side music (phils-bridge) | manual:hw | manual:hw | manual:hw | manual:hw | manual:hw | manual:hw |
| Karaoke 3-line scroll | e2e | n/a | n/a | n/a | n/a | manual |
| Tap-pause-resume | e2e | n/a | n/a | n/a | n/a | n/a |
| Swipe-bias offset | e2e | n/a | n/a | n/a | n/a | n/a |
| v0.4.0 contextual menu: Lyrics earlier / later move the persisted offset by 500 ms (state marker `offset=`), Restart with no song is a no-op; spec passes the SDK page-menu validator; `stepOffset` clamps to the slider range | e2e:5-7 + unit:menu | unit:menu (limits, unique ids, no exit item, clamp) | n/a | n/a | n/a | n/a |
| Menu Restart song / Center on clock with a loaded song; Re-sync to player with auto-detect on | manual:hw (needs a loaded song and a live player) | e2e:7 (no song) | n/a | manual:hw | manual:hw | manual:hw |
| SDK floor: pin ≥ 0.0.16, installed = pin, `app.json` `min_sdk_version` = installed (0.0.14 / 0.0.15 re-fire timers, see KNOWN_QUIRKS) | unit:sdk-floor | unit:sdk-floor | n/a | n/a | n/a | n/a |
| Position-anchored clock | unit:lrc | unit:lrc | n/a | n/a | n/a | n/a |
| Drift correction (re-anchor on >2s) | unit:lrc | n/a | n/a | manual:hw | unit:lrc | unit:lrc |
| LRC parser (multi-stamp, dedupe) | unit:lrc:23 | unit:lrc:rejects | n/a | n/a | n/a | n/a |
| LRCLIB HTTP client | unit:lrclib | n/a | unit:lrclib | manual:hw | n/a | n/a |
| Last-song memory (resume mid-line) | unit:storage TODO | n/a | n/a | n/a | n/a | n/a |
| Last-track-id storage | unit:storage TODO | n/a | n/a | n/a | n/a | n/a |
| Bridge polling at 5s cadence | manual:hw | manual:hw | n/a | manual:hw | manual:hw | manual:hw |

## By dimension (status)

- **Static:** lint+tsc ✓, app-json validation ✓
- **Unit:** 54/54 tests passing (LRC parser + binary-search line picker + drift correction + Spotify + menu + SDK floor)
- **E2E:** `scripts/regression.mjs` (`npm run test:e2e`, simulator 0.9.5 via `npm run sim`) — 8/8 simulator smoke regression. The double-tap exit runs last: simulator 0.9.5 honours `shutDownPageContainer`, so every input after it is dropped.
- **Backend integration:** `scripts/test-backends.mjs` — LRCLIB live fetch
- **Performance:** 250ms re-render cadence (faster than dashboard's 10s heartbeat) — verified by hand
- **Security:** Spotify dev-app credentials in `.env` (v0.3 path); no secrets in source ✓
- **Privacy:** no song history persisted server-side; bridge is local-only
- **Migration:** v0.1 → v0.2 added auto-detect + position-anchored clock + drift-correction — verified
- **Regression:** drift-correction (re-anchor when our clock and Mac clock diverge >2s), track-change detection

## Outstanding gaps before v0.3 ship (Spotify Web API)

- [ ] Spotify OAuth flow integration test (mock + real)
- [ ] Musixmatch fallback when LRCLIB misses
- [ ] iPhone playback auto-detect (currently Mac-only via phils-bridge)
- [ ] Storage round-trip tests for last-song / last-track-id
- [ ] Network whitelist consistency check (LRCLIB + future Spotify + Musixmatch hosts)
