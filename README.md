# Lyrics Glow

> **Karaoke through your glasses.**

A standalone Even Realities G2 plugin that scrolls time-synced lyrics on the 576×288 greyscale display in lockstep with whatever song you tell it. Three-line karaoke window (prev / **▶ current** / next / next+1), manual play/pause via tap, swipe to nudge ±1 line if the sync drifts.

## Status: v0.4.0 (SDK 0.0.16: tap-and-hold menu)

> **v0.4.0 (2026-11-03):** SDK 0.0.10 → **0.0.16**, simulator 0.9.5, CLI 0.2.0; install floor is now Even app 2.2.10. Tap-and-hold opens a five-item contextual menu: Restart song, Lyrics earlier 500ms, Lyrics later 500ms (both move the same offset the phone slider edits and persist it), Center on clock (clears the swipe bias without a ring), Re-sync to player (forces the next auto-detect poll to reload and re-anchor). The state marker now carries `offset=` so the simulator run can assert the offset items without a song. `tests/sdk-floor.test.ts` refuses a pin below 0.0.16. 54 unit + 8 e2e green. v0.3.0 (Spotify Web API auto-detect) shipped without a README status update.

The full karaoke renderer + LRCLIB lookup from v0.1.0, plus an optional auto-detect mode: paste your phils-bridge URL and toggle the checkbox, and Lyrics Glow will poll `/now-playing.json` every 3s, fetch fresh LRCLIB lyrics on every track change, and anchor the karaoke clock to the bridge-reported playback position. Works for music playing on your Mac (Music or Spotify desktop apps via AppleScript). iPhone Spotify auto-detect needs Spotify OAuth and is deferred to v0.3.

| Version | What's in it |
|---|---|
| v0.1.0 | Phone-side song picker, LRCLIB lookup, time-synced 3-line karaoke window, tap pause/resume, swipe ±1 line, offset slider, persistent last-song memory, plain-lyrics fallback |
| **v0.2.0** *(current)* | Auto-detect mode: phils-bridge `/now-playing.json` polling, automatic track-change handling, position-based clock anchoring, drift correction (re-anchors when our clock and the Mac clock differ by more than 2s) |
| v0.3.0 *(planned)* | Spotify OAuth on the bridge so iPhone Spotify playback also auto-detects, Musixmatch fallback for tracks LRCLIB doesn't have |

## How auto-detect works (v0.2.0)

1. Make sure your phils-bridge is running (`~/ai-agents/phils-bridge/server.py` on port 8790).
2. In Lyrics Glow phone settings, paste the bridge URL (e.g. `http://10.168.168.105:8790` or your Tailscale IP) and tick **Use auto-detect**.
3. Start playing a song in Music or Spotify on your Mac.
4. Within 3s the app fetches the matching LRCLIB lyrics, anchors the karaoke clock to the current playback position, and the glasses start scrolling in sync.
5. Pause Mac playback → karaoke pauses. Skip to next track → fresh lyrics auto-load. Drift > 2s → auto re-anchor.

Manual song picker still works as before — useful when LRCLIB doesn't have the track or you want to scrub to a different song. The two modes coexist; turning auto-detect off leaves the manual flow untouched.

## How it works (manual mode)

1. Open Lyrics Glow from the Even Hub launcher on your phone.
2. Type **Artist** + **Title** into the phone settings page (e.g. `Queen` / `Bohemian Rhapsody`).
3. Hit **Load lyrics**. The app calls [LRCLIB](https://lrclib.net) — community-maintained, no account needed — and parses the `[mm:ss.xx]`-stamped LRC into a sorted line table.
4. Put on the glasses.
5. **Tap** glasses to start playback. The 3-line karaoke window advances against a local clock that's anchored to your tap.
6. If lyrics drift (BLE + WebView render adds latency), drag the **Offset** slider in phone settings — negative shows lyrics earlier, positive later. The setting persists.
7. **Swipe up / down** on the glasses to nudge ±1 line manually if a verse goes out of sync.
8. **Tap again** to pause/resume.
9. **Glasses double-tap** = exit. **Ring double-tap** = clear manual line bias and re-anchor to the picker.

## Glasses gestures

| Gesture | Action |
|---|---|
| Single tap | Toggle play / pause |
| Swipe up | Nudge current line backward (-1) |
| Swipe down | Nudge current line forward (+1) |
| Ring double-tap | Clear manual bias; resync to clock |
| Glasses double-tap | Exit app |
| Tap-and-hold | Contextual menu: Restart song, Lyrics earlier / later 500ms, Center on clock, Re-sync to player |

## When LRCLIB has no time-sync

Some tracks only have **plain** (untimed) lyrics in LRCLIB — particularly newer or obscure releases. Lyrics Glow detects this and falls back to showing the first six plain-text lines as a static block. No auto-scroll. v0.3.0 will add Musixmatch as a secondary source for time-sync.

## Development

```bash
npm install
npm run dev          # Vite dev server on :5177 (host 0.0.0.0 for LAN)
npm run build        # tsc + vite build → dist/
npm run pack         # evenhub pack → lyrics-glow.ehpk
npm run deploy       # build + pack
npm test             # Vitest unit tests (54 passing)
npm run test:watch   # Vitest watch mode
npm run sim          # simulator on :9898 against the dev server
npm run test:e2e     # Simulator-driven smoke test (8 passing; needs dev + sim running)
npx evenhub upload lyrics-glow.ehpk -m "<changelog>"   # CLI 0.2.0, after a one-time evenhub login from a real Terminal
```

Test on real glasses via QR:
```bash
npx evenhub qr --url http://<your-mac-lan-ip>:5177
```

Test in simulator (the package is scoped and ships no `.bin`, so `npx evenhub-simulator` 404s; `npm run sim` launches it by path):
```bash
npm run dev & npm run sim
```

## Source files

| File | Purpose |
|---|---|
| `src/main.ts` | Entry, phone settings UI, state machine, 250ms render tick |
| `src/even.ts` | Glasses bridge wrapper (text container, gestures, contextual menu, BLE-write mutex) |
| `src/menu.ts` | Contextual-menu spec (ids + verb labels) and the offset step/clamp |
| `src/lrc.ts` | Pure-logic LRC parser + binary-search line picker + window helper |
| `src/lrclib.ts` | LRCLIB HTTP client with tagged-union result type |
| `src/storage.ts` | Native `setLocalStorage` wrapper for last song + offset memory |
| `tests/lrc.test.ts` | 17 vitest cases — parser edge cases + line-picker correctness |
| `tests/lrclib.test.ts` | 6 vitest cases (fetch-mocked) — request shape + error mapping |
| `scripts/regression.mjs` | Simulator-driven smoke test (boot, ticks, gesture safety) |

## Why no Python bridge in v0.1.0?

LRCLIB ships `Access-Control-Allow-Origin: *`, so the WebView can call it directly. No proxy required. v0.2.0 adds the bridge only because Spotify's `currently-playing` API needs OAuth — and OAuth flows can't live entirely inside the plugin.

## Privacy

- No mic, no camera, no audio capture. Lyrics Glow only does HTTP GETs to LRCLIB.
- The artist + title you type are sent to LRCLIB to look up the matching record (that's how the API works).
- The last song you loaded is stored locally on your phone (Even Hub native storage). Nothing is sent to anyone other than LRCLIB on lookup.
- No analytics, no telemetry.

## Packaging

`app.json` whitelists `https://lrclib.net` — no edits needed before `npm run pack`.

## Roadmap

Full plan in `~/Documents/Pulse/ROADMAP.md` § "Plan: Lyrics Overlay".
