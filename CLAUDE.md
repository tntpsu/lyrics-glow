# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Lyrics Glow** — synced lyrics overlay for Even Realities G2 smart glasses. Auto-detects what's playing on the user's Mac (via `phils-bridge` running locally), fetches synced LRC lyrics from [LRCLIB](https://lrclib.net/), and renders a karaoke-style line-by-line follow on the glasses display. Manual mode (paste artist + title) when auto-detect isn't available.

One of four Even-glasses-app repos at `~/Documents/{Cue,Pulse,Glance,lyrics-glow}`.

## Commands

```bash
npm run dev                   # Vite (port set in vite.config.ts)
npm run build                 # tsc + vite build → dist/
npm run pack                  # lint-app-json + evenhub pack → lyrics-glow.ehpk
npm run deploy                # build + pack
npm test                      # vitest (33 tests)
npm run test:e2e              # simulator regression
npm run test:backends         # live integration tests against LRCLIB + phils-bridge
npx evenhub qr --url http://<lan-ip>:<port>
```

## Architecture

1. **Auto-detect** (v0.2.0): polls `http://<phils-bridge>/now-playing.json` every 1.5s. phils-bridge is a Python service the user runs on their Mac — same one Pulse uses for Mac-side data. Returns `{artist, title, position_seconds}` for the currently-playing song in iTunes/Music/Spotify/etc via macOS MediaRemote.
2. **LRC lookup** (`src/lrclib.ts`): hits `https://lrclib.net/api/get?artist=…&track_name=…`. Public, no auth, free. Returns synced LRC content (line-by-line timestamps).
3. **LRC parser** (`src/lrc.ts`): parses `[mm:ss.cc]` timestamps, builds an array of `{ts, line}`. Binary search by current playback position picks the line to display.
4. **Glasses render** (`src/main.ts` + `src/even.ts`): full-screen text container; updates ~250ms ticked from playback position. Single full-screen container (the same pattern as Cue / Pulse).

## Conventions

- **Auto-detect requires phils-bridge** running on Mac (LAN or Tailscale). When unreachable, manual mode (paste artist+title) is the fallback. The connection state appears in phone-side settings.
- **Manual mode** lets the user paste artist + title, fetch LRC, then tap "Start" — Lyrics Glow runs its own playback timer (no real audio sync, just a constant-rate scroll).
- **No-LRC fallback**: if LRCLIB has no synced version, we show plain (un-synced) lyrics scrolling at a constant rate based on track length / line count.
- **State markers**: `console.log('[lyricsglow:state] ...')` from `src/main.ts paint()` — used by `scripts/regression.mjs` and the shared `countStateLogs()` helper.

## Critical quirks (also see KNOWN_QUIRKS.md)

- **LRCLIB occasionally returns synced lyrics with malformed timestamps** (`[mm:ss]` without subseconds). Parser must handle both `[mm:ss]` and `[mm:ss.cc]`.
- **phils-bridge polling is 1.5s** — too aggressive and the bridge complains; too slow and song-change detection lags. The 1.5s is empirically tuned.
- **Concurrent `textContainerUpgrade` crashes the BLE link** — render serialized in `src/even.ts`. Same pattern as Cue / Pulse.

## Roadmap (v0.3+)

- Phone-side music auto-detect via MediaSession API (no Mac dependency) — see `~/Documents/Pulse/ROADMAP.md` § "Lyrics Glow"
- Translation overlay for non-English lyrics
- Singing-practice scoring (mic-on, pitch/timing)

## Sister repos

`Cue / Pulse / Glance` share `KNOWN_QUIRKS.md`, `NOTICE`, `scripts/lint-app-json.mjs`. The four apps have divergent state machines; don't propagate `src/` files cross-repo.
