# Lyrics Glow

> **Karaoke through your glasses.**

A standalone Even Realities G2 plugin that scrolls time-synced lyrics on the 576×288 greyscale display in lockstep with whatever song you tell it. Three-line karaoke window (prev / **▶ current** / next / next+1), manual play/pause via tap, swipe to nudge ±1 line if the sync drifts.

## Status: v0.1.0 (manual song picker; auto-detect comes in v0.2)

This release ships the full karaoke renderer + LRCLIB integration, but stops short of auto-detecting "now playing" — you type the artist + title in phone settings and hit **Load**. Auto-detect (Spotify OAuth → currently-playing → song change events) lands in v0.2.0 once the phone-side bridge exists.

| Version | What's in it |
|---|---|
| **v0.1.0** *(current)* | Phone-side song picker, LRCLIB lookup, time-synced 3-line karaoke window, tap pause/resume, swipe ±1 line, offset slider, persistent last-song memory, mock-fallback when only plain (untimed) lyrics are available |
| v0.2.0 *(planned)* | Spotify OAuth + auto-detect "now playing" via a new phone-side bridge (`~/ai-agents/lyrics-bridge`) |
| v0.3.0 *(planned)* | Musixmatch fallback for tracks LRCLIB doesn't have, lyrics provider preference toggle |

## How it works

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

## When LRCLIB has no time-sync

Some tracks only have **plain** (untimed) lyrics in LRCLIB — particularly newer or obscure releases. Lyrics Glow detects this and falls back to showing the first six plain-text lines as a static block. No auto-scroll. v0.3.0 will add Musixmatch as a secondary source for time-sync.

## Development

```bash
npm install
npm run dev          # Vite dev server on :5177 (host 0.0.0.0 for LAN)
npm run build        # tsc + vite build → dist/
npm run pack         # evenhub pack → lyrics-glow.ehpk
npm run deploy       # build + pack
npm test             # Vitest unit tests (23 passing — LRC parser + LRCLIB client)
npm run test:watch   # Vitest watch mode
npm run test:e2e     # Simulator-driven smoke test (5 passing)
```

Test on real glasses via QR:
```bash
npx evenhub qr --url http://<your-mac-lan-ip>:5177
```

Test in simulator:
```bash
npx evenhub-simulator --glow http://localhost:5177
# OR with automation port for the regression script:
npx evenhub-simulator --automation-port 9898 http://localhost:5177
```

## Source files

| File | Purpose |
|---|---|
| `src/main.ts` | Entry, phone settings UI, state machine, 250ms render tick |
| `src/even.ts` | Glasses bridge wrapper (text container, gestures, BLE-write mutex) |
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
