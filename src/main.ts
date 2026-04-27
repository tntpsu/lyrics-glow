// LyricsGlow — karaoke-through-glasses.
//
// v0.1.0: phone-side song picker (artist + title) → LRCLIB lookup →
// 3-line karaoke window on glasses, advanced by a local 250ms tick against
// the LRC timestamps. Manual offset slider compensates for BLE+render lag.
//
// v0.2.0 (this file): optional auto-detect mode. When the user pastes a
// phils-bridge URL and toggles auto-detect on, the app polls
// /now-playing.json every NOW_PLAYING_POLL_MS, fetches fresh LRCLIB lyrics
// on track change, and anchors playback to the bridge-reported position.
// Works for music playing on the user's Mac (Music or Spotify desktop apps
// via AppleScript). iPhone Spotify auto-detect would require Spotify OAuth
// and is deferred to v0.3+.

import { connectEvenRuntime, type EvenRuntime, type InputSource, type SwipeDir } from './even'
import { fetchLyrics } from './lrclib'

// Phone-side fetch debug log — captures every LRCLIB call so the user
// can see what the API is returning when something doesn't work. Same
// pattern as Glance v0.5.1 / Cue v0.3.4. Capped, in-memory only.
const FETCH_LOG_CAP = 50
const fetchLog: LyricsFetchLog[] = []
function pushFetchLog(entry: LyricsFetchLog): void {
  fetchLog.unshift(entry)
  if (fetchLog.length > FETCH_LOG_CAP) fetchLog.length = FETCH_LOG_CAP
  renderFetchLog()
}
function fmtAgo(ts: number): string {
  const sec = Math.round((Date.now() - ts) / 1000)
  if (sec < 60) return `${sec}s ago`
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`
  return `${Math.round(sec / 3600)}h ago`
}
function renderFetchLog(): void {
  const el = document.getElementById('fetch-log')
  if (!el) return
  if (fetchLog.length === 0) {
    el.innerHTML = '<div style="color:#7b7b7b;">No fetches yet.</div>'
    return
  }
  el.innerHTML = fetchLog
    .map(e => {
      const status = e.ok
        ? `<span style="color:#2a2;">${e.status ?? '?'}</span>`
        : `<span style="color:#c00;">${e.status ?? 'NET'}</span>`
      const url = e.url.length > 80 ? e.url.slice(0, 77) + '…' : e.url
      const err = e.error ? `<div style="color:#c00; margin-top:.15rem;">↳ ${escapeHtml(e.error)}</div>` : ''
      return `<div style="padding:.35rem 0; border-bottom:1px solid #f0f0f0;">
        <div style="display:flex; gap:.5rem; align-items:center;">
          <span style="color:#999; min-width:6em;">${fmtAgo(e.ts)}</span>
          ${status}
          <span style="color:#555;">${e.via} ${e.ms}ms</span>
        </div>
        <div style="color:#232323; word-break:break-all;">${escapeHtml(url)}</div>
        ${err}
      </div>`
    })
    .join('')
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}
setLyricsLogger(pushFetchLog)
import { lineWindow, parseLrc, pickLineIndex, type LrcLine } from './lrc'
import { fetchNowPlaying, trackKey, type NowPlayingTrack } from './now-playing'
import {
  getAutoDetect,
  getBridgeUrl,
  getLastSong,
  getOffsetMs,
  setAutoDetect,
  setBridgeUrl,
  setLastSong,
  setOffsetMs,
  setStorageBridge,
} from './storage'
import { setLyricsLogger, type LyricsFetchLog } from './lrclib'

const RENDER_TICK_MS = 250
const NOW_PLAYING_POLL_MS = 3_000 // bridge poll cadence in auto-detect mode

interface SongState {
  artist: string
  track: string
  /** Parsed timestamped lines, or [] if only plain lyrics were available. */
  lines: LrcLine[]
  /** Untimed plain text, used as fallback display when `lines` is empty. */
  plainLyrics: string | null
}

let even: EvenRuntime | null = null
let song: SongState | null = null

/** Wall-clock timestamp at which the song "started" (track time = 0). */
let startedAtMs = 0
/** Where playback was paused (track time in ms), or 0 when running. */
let pausedAtMs = 0
let isPlaying = false

/** Manual nudge added to "current line" picker — compensates for BLE+render latency. */
let offsetMs = 0
/** Manual line bias — swipe up/down adds ±1 to the picker result. */
let manualLineBias = 0

let renderTimer: ReturnType<typeof setInterval> | null = null
let lastRenderedKey = '' // dedupe identical paints (line index + bias + paused)

// Auto-detect (v0.2.0) state.
let bridgeUrl = ''
let autoDetectOn = false
let nowPlayingTimer: ReturnType<typeof setInterval> | null = null
let lastTrackKey = '' // detect track changes between polls
let autoDetectStatus = '' // last status line for the phone-side UI

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
  <main style="font-family: system-ui, sans-serif; max-width: 560px; margin: 2rem auto; padding: 0 1rem; color: #232323;">
    <h1 style="margin: 0 0 .25rem 0;">Lyrics Glow <span style="font-size: .55em; color: #7b7b7b; font-weight: 400;">v__APP_VERSION__</span></h1>
    <p style="margin: 0 0 1rem 0; color: #555;">Karaoke through your glasses. Type a song, hit Load, then put on the glasses.</p>

    <section style="background: #f5f5f5; padding: 1rem 1.25rem; border-radius: 8px; margin-bottom: 1rem;">
      <label style="display:block; font-size:.85rem; font-weight:600; margin-bottom:.25rem;">Artist</label>
      <input id="artist" type="text" placeholder="e.g. Queen" style="width:100%; padding:.5rem; font-size:1rem; box-sizing:border-box;" />
      <label style="display:block; font-size:.85rem; font-weight:600; margin:.75rem 0 .25rem;">Title</label>
      <input id="track" type="text" placeholder="e.g. Bohemian Rhapsody" style="width:100%; padding:.5rem; font-size:1rem; box-sizing:border-box;" />

      <div style="display:flex; gap:.5rem; margin-top:1rem;">
        <button id="load" type="button" style="flex:1; padding:.6rem; font-size:1rem; background:#232323; color:#fff; border:0; border-radius:4px; cursor:pointer;">Load lyrics</button>
        <button id="play" type="button" style="flex:1; padding:.6rem; font-size:1rem; background:#1a8d3a; color:#fff; border:0; border-radius:4px; cursor:pointer;" disabled>▶ Play</button>
        <button id="reset" type="button" style="padding:.6rem .9rem; font-size:1rem; background:#eee; color:#232323; border:0; border-radius:4px; cursor:pointer;" disabled>↺</button>
      </div>

      <label style="display:block; font-size:.85rem; font-weight:600; margin:1rem 0 .25rem;">Offset compensation: <span id="offset-label">0</span> ms</label>
      <input id="offset" type="range" min="-3000" max="3000" step="100" value="0" style="width:100%;" />
      <p style="font-size:.75rem; color:#777; margin:.25rem 0 0 0;">Negative = lyrics show earlier. Positive = lyrics show later.</p>
    </section>

    <section style="background:#f5f5f5; padding:1rem 1.25rem; border-radius:8px; margin-bottom:1rem;">
      <h3 style="margin:0 0 .5rem 0; font-size:1rem;">Auto-detect (v0.2)</h3>
      <p style="margin:0 0 .75rem 0; font-size:.85rem; color:#555;">Polls phils-bridge for the song playing on your Mac (Music or Spotify desktop) and auto-fetches lyrics on every track change. iPhone Spotify isn't supported yet (needs OAuth — v0.3).</p>

      <label style="display:block; font-size:.85rem; font-weight:600; margin-bottom:.25rem;">phils-bridge URL</label>
      <input id="bridge-url" type="text" placeholder="http://10.168.168.105:8790" style="width:100%; padding:.5rem; font-size:.95rem; box-sizing:border-box;" />
      <p style="font-size:.7rem; color:#777; margin:.25rem 0 .75rem 0;">Same bridge that powers Pulse. Tailscale-friendly.</p>

      <label style="display:flex; align-items:center; gap:.5rem; font-size:.95rem; cursor:pointer;">
        <input id="auto-detect" type="checkbox" /> Use auto-detect when Mac music is playing
      </label>
      <p id="auto-status" style="font-size:.75rem; color:#666; margin:.5rem 0 0 0;">—</p>
    </section>

    <p id="status" style="font-size:.9rem; color:#444; margin:0 0 .5rem 0;">Initialising…</p>
    <pre id="preview" style="background:#111; color:#7fff7f; padding:1rem; border-radius:8px; min-height:200px; font-size:.95rem; line-height:1.5; white-space:pre-wrap;">(glasses preview)</pre>

    <details style="margin-top:1rem; color:#555;">
      <summary style="cursor:pointer;">Glasses gestures</summary>
      <ul style="font-size:.9rem; line-height:1.6;">
        <li>Single tap — pause / resume</li>
        <li>Swipe up / down — nudge current line ±1</li>
        <li>Ring double-tap — re-anchor to the picker (clear manual line bias)</li>
        <li>Glasses double-tap — exit app</li>
      </ul>
    </details>

    <details style="margin-top:1rem;">
      <summary style="cursor:pointer; color:#232323;">Recent fetches (debug)</summary>
      <p style="color:#7b7b7b; font-size:.85em; margin:.5rem 0;">Last 50 calls to LRCLIB / phils-bridge with status, latency, error.</p>
      <div style="display:flex; gap:.5rem; margin-bottom:.5rem;">
        <button id="fetch-log-clear" type="button" style="padding:.35rem .7rem; cursor:pointer; background:#eee;">Clear</button>
        <button id="fetch-log-refresh" type="button" style="padding:.35rem .7rem; cursor:pointer; background:#eee;">Refresh</button>
      </div>
      <div id="fetch-log" style="max-width:720px; max-height:280px; overflow-y:auto; font-family: ui-monospace, monospace; font-size:.8em; border:1px solid #ddd; padding:.5rem;"></div>
    </details>

    <p style="font-size:.75rem; color:#999; margin-top:1.5rem;">Lyrics: <a href="https://lrclib.net" target="_blank" rel="noopener">LRCLIB</a> (community-maintained, no account).</p>
  </main>
`

const artistInput = app.querySelector<HTMLInputElement>('#artist')!
const trackInput = app.querySelector<HTMLInputElement>('#track')!
const loadBtn = app.querySelector<HTMLButtonElement>('#load')!
const playBtn = app.querySelector<HTMLButtonElement>('#play')!
const resetBtn = app.querySelector<HTMLButtonElement>('#reset')!
const offsetSlider = app.querySelector<HTMLInputElement>('#offset')!
const offsetLabel = app.querySelector<HTMLSpanElement>('#offset-label')!
const status = app.querySelector<HTMLParagraphElement>('#status')!
const preview = app.querySelector<HTMLPreElement>('#preview')!
const bridgeUrlInput = app.querySelector<HTMLInputElement>('#bridge-url')!
const autoDetectInput = app.querySelector<HTMLInputElement>('#auto-detect')!
const autoStatus = app.querySelector<HTMLParagraphElement>('#auto-status')!

// --- timing ---

function nowTrackMs(): number {
  if (!isPlaying) return pausedAtMs
  return Date.now() - startedAtMs
}

function setPlaying(next: boolean): void {
  if (next === isPlaying) return
  if (next) {
    // Resuming — pin start so nowTrackMs picks up where we left off.
    startedAtMs = Date.now() - pausedAtMs
    isPlaying = true
    playBtn.textContent = '❙❙ Pause'
    if (!renderTimer) renderTimer = setInterval(() => void paint(), RENDER_TICK_MS)
  } else {
    pausedAtMs = nowTrackMs()
    isPlaying = false
    playBtn.textContent = '▶ Play'
  }
  void paint()
}

function resetPlayback(): void {
  pausedAtMs = 0
  startedAtMs = Date.now()
  manualLineBias = 0
  void paint()
}

// --- glasses render ---

function renderGlassesText(): string {
  const lines: string[] = []
  if (!song) {
    lines.push('Lyrics Glow')
    lines.push('')
    lines.push('Open the phone settings,')
    lines.push('paste a song, then come back.')
    return lines.join('\n')
  }
  // Header.
  const headerArtist = song.artist || '(unknown artist)'
  const headerTrack = song.track || '(unknown track)'
  lines.push(`${headerArtist} — ${headerTrack}`)

  if (song.lines.length === 0) {
    // Plain-only fallback: no time-sync available.
    lines.push('───────────────────────────')
    lines.push('(no time-synced lyrics found)')
    if (song.plainLyrics) {
      const plain = song.plainLyrics.split('\n').slice(0, 6)
      for (const l of plain) lines.push(l)
    }
    return lines.join('\n')
  }

  // Time-synced karaoke window.
  const t = nowTrackMs() + offsetMs
  const baseIdx = pickLineIndex(song.lines, t)
  const idx = Math.max(-1, Math.min(song.lines.length - 1, baseIdx + manualLineBias))
  const window = lineWindow(song.lines, idx, 1, 2)
  // window = [prev, current, next, next+1]
  lines.push('───────────────────────────')
  const [prev, current, next1, next2] = window
  lines.push(prev?.text || ' ')
  lines.push(`▶ ${current?.text || ' '}`)
  lines.push(`  ${next1?.text || ' '}`)
  lines.push(`  ${next2?.text || ' '}`)
  // Footer with elapsed / total + state.
  const tot = song.lines[song.lines.length - 1]?.timeMs ?? 0
  const fmt = (ms: number): string => {
    const s = Math.max(0, Math.floor(ms / 1000))
    const mm = Math.floor(s / 60)
    const ss = (s % 60).toString().padStart(2, '0')
    return `${mm}:${ss}`
  }
  const tag = isPlaying ? '▶' : '❙❙'
  lines.push('')
  lines.push(`${tag} ${fmt(t)} / ${fmt(tot)}`)
  return lines.join('\n')
}

async function paint(): Promise<void> {
  const t = nowTrackMs() + offsetMs
  const idxBase = song ? pickLineIndex(song.lines, t) : -2
  // State log fires every tick so the regression harness can latch on at any
  // moment. The render-side dedupe (`lastRenderedKey`) prevents redundant BLE
  // writes when the visible content hasn't changed.
  // eslint-disable-next-line no-console
  console.log(`[lyricsglow:state] line=${idxBase} bias=${manualLineBias} playing=${isPlaying ? 1 : 0} loaded=${song ? 1 : 0}`)
  const text = renderGlassesText()
  const key = `${text}`
  if (key === lastRenderedKey) return
  lastRenderedKey = key
  preview.textContent = text
  if (even) await even.render(text)
}

// --- input handlers ---

function onTap(_source: InputSource): void {
  if (!song) return
  setPlaying(!isPlaying)
}

function onSwipe(dir: SwipeDir, _source: InputSource): void {
  if (!song || song.lines.length === 0) return
  manualLineBias += dir === 'down' ? +1 : -1
  void paint()
}

function onDoubleTap(source: InputSource): void {
  if (source === 'ring') {
    manualLineBias = 0
    void paint()
    return
  }
  if (even) void even.exitApp()
}

// --- load lyrics ---

async function loadFromInputs(): Promise<void> {
  const artist = artistInput.value.trim()
  const track = trackInput.value.trim()
  if (!artist || !track) {
    status.textContent = 'Need both artist and title.'
    return
  }
  status.textContent = `Looking up “${track}” by ${artist}…`
  loadBtn.disabled = true
  const result = await fetchLyrics({ artistName: artist, trackName: track })
  loadBtn.disabled = false
  if (result.ok === false) {
    const r = result
    if (r.status === 'not-found') {
      status.textContent = `LRCLIB has no entry for “${track}” by ${artist}. Try a different spelling.`
    } else if (r.status === 'network') {
      status.textContent = `Network error: ${r.detail}`
    } else {
      status.textContent = `LRCLIB error: ${r.detail ?? 'unknown'}`
    }
    return
  }
  await setLastSong(artist, track)
  const lrcLines = result.track.syncedLyrics ? parseLrc(result.track.syncedLyrics) : []
  song = {
    artist: result.track.artistName,
    track: result.track.trackName,
    lines: lrcLines,
    plainLyrics: result.track.plainLyrics,
  }
  pausedAtMs = 0
  startedAtMs = Date.now()
  manualLineBias = 0
  isPlaying = false
  playBtn.textContent = '▶ Play'
  playBtn.disabled = false
  resetBtn.disabled = false
  if (lrcLines.length === 0) {
    status.textContent = `Loaded plain lyrics only — ${song.plainLyrics?.split('\n').length ?? 0} lines (no time-sync).`
  } else {
    status.textContent = `Loaded ${lrcLines.length} time-synced lines. Tap glasses (or Play) to start.`
  }
  await paint()
}

loadBtn.addEventListener('click', () => { void loadFromInputs() })
playBtn.addEventListener('click', () => { setPlaying(!isPlaying) })
resetBtn.addEventListener('click', resetPlayback)

// Wire fetch-log debug panel buttons (DOM elements added in v0.2.1)
const fetchLogClearBtn = document.getElementById('fetch-log-clear') as HTMLButtonElement | null
const fetchLogRefreshBtn = document.getElementById('fetch-log-refresh') as HTMLButtonElement | null
if (fetchLogClearBtn) fetchLogClearBtn.addEventListener('click', () => { fetchLog.length = 0; renderFetchLog() })
if (fetchLogRefreshBtn) fetchLogRefreshBtn.addEventListener('click', () => renderFetchLog())
renderFetchLog()
offsetSlider.addEventListener('input', () => {
  offsetMs = parseInt(offsetSlider.value, 10) || 0
  offsetLabel.textContent = String(offsetMs)
  void setOffsetMs(offsetMs)
  void paint()
})

// --- auto-detect (v0.2.0) ---

async function loadFromTrack(artist: string, track: string, anchorPositionMs: number): Promise<void> {
  // Mirror loadFromInputs but with a known starting position so the karaoke
  // clock anchors to where playback actually is, not where it began.
  const result = await fetchLyrics({ artistName: artist, trackName: track })
  if (result.ok === false) {
    const r = result
    autoDetectStatus =
      r.status === 'not-found'
        ? `No LRCLIB match for ${track} — ${artist}`
        : `Lookup failed: ${r.detail ?? r.status}`
    autoStatus.textContent = autoDetectStatus
    return
  }
  await setLastSong(artist, track)
  const lrcLines = result.track.syncedLyrics ? parseLrc(result.track.syncedLyrics) : []
  song = {
    artist: result.track.artistName,
    track: result.track.trackName,
    lines: lrcLines,
    plainLyrics: result.track.plainLyrics,
  }
  pausedAtMs = anchorPositionMs
  startedAtMs = Date.now() - anchorPositionMs
  manualLineBias = 0
  isPlaying = true
  playBtn.textContent = '❙❙ Pause'
  playBtn.disabled = false
  resetBtn.disabled = false
  artistInput.value = artist
  trackInput.value = track
  if (!renderTimer) renderTimer = setInterval(() => void paint(), RENDER_TICK_MS)
  autoDetectStatus = `Auto-loaded: ${result.track.trackName} — ${result.track.artistName}${
    lrcLines.length > 0 ? '' : ' (plain only)'
  }`
  autoStatus.textContent = autoDetectStatus
  await paint()
}

async function pollNowPlaying(): Promise<void> {
  if (!autoDetectOn) return
  const result = await fetchNowPlaying(bridgeUrl)
  if (result.ok === false) {
    autoDetectStatus = `Bridge: ${result.status}${result.detail ? ` (${result.detail})` : ''}`
    autoStatus.textContent = autoDetectStatus
    return
  }
  const t: NowPlayingTrack = result.track
  if (!t.playing) {
    if (isPlaying) {
      // Mac stopped → pause our karaoke clock so it stops moving.
      setPlaying(false)
    }
    autoDetectStatus = 'Mac idle — nothing playing'
    autoStatus.textContent = autoDetectStatus
    lastTrackKey = ''
    return
  }
  const key = trackKey(t)
  if (key && key !== lastTrackKey) {
    // Track change — fetch fresh lyrics and anchor to the bridge-reported
    // position. Use 0 as anchor when position isn't available so we at
    // least start from the top.
    lastTrackKey = key
    await loadFromTrack(t.artist ?? '', t.track ?? '', t.positionMs ?? 0)
    return
  }
  // Same track — drift correction. If our clock has drifted more than 2s
  // from the bridge's reported position, re-anchor.
  if (t.positionMs !== null && t.positionMs !== undefined && song) {
    const ourPos = isPlaying ? Date.now() - startedAtMs : pausedAtMs
    if (Math.abs(ourPos - t.positionMs) > 2_000) {
      pausedAtMs = t.positionMs
      startedAtMs = Date.now() - t.positionMs
      if (!isPlaying) {
        isPlaying = true
        playBtn.textContent = '❙❙ Pause'
      }
      autoDetectStatus = `Re-anchored to ${Math.round(t.positionMs / 1000)}s`
      autoStatus.textContent = autoDetectStatus
    }
  }
}

function startAutoDetect(): void {
  if (nowPlayingTimer) return
  nowPlayingTimer = setInterval(() => void pollNowPlaying(), NOW_PLAYING_POLL_MS)
  void pollNowPlaying() // fire one immediately
}

function stopAutoDetect(): void {
  if (nowPlayingTimer) {
    clearInterval(nowPlayingTimer)
    nowPlayingTimer = null
  }
  lastTrackKey = ''
  autoDetectStatus = 'Auto-detect off'
  autoStatus.textContent = autoDetectStatus
}

bridgeUrlInput.addEventListener('change', () => {
  bridgeUrl = bridgeUrlInput.value.trim()
  void setBridgeUrl(bridgeUrl)
  if (autoDetectOn) {
    stopAutoDetect()
    startAutoDetect()
  }
})

autoDetectInput.addEventListener('change', () => {
  autoDetectOn = autoDetectInput.checked
  void setAutoDetect(autoDetectOn)
  if (autoDetectOn) {
    if (!bridgeUrl) {
      autoDetectStatus = 'Set the bridge URL first.'
      autoStatus.textContent = autoDetectStatus
      autoDetectInput.checked = false
      autoDetectOn = false
      return
    }
    startAutoDetect()
  } else {
    stopAutoDetect()
  }
})

// --- bootstrap ---

async function bootstrap(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('[lyricsglow] bootstrap start')
  status.textContent = 'Connecting to glasses…'
  even = await connectEvenRuntime(`Lyrics Glow v${__APP_VERSION__}\n\nLoading…`)

  if (even) {
    setStorageBridge({ getStorage: even.getStorage, setStorage: even.setStorage })
  }

  // Hydrate stored config.
  const last = await getLastSong()
  artistInput.value = last.artist
  trackInput.value = last.track
  offsetMs = await getOffsetMs()
  offsetSlider.value = String(offsetMs)
  offsetLabel.textContent = String(offsetMs)
  bridgeUrl = await getBridgeUrl()
  bridgeUrlInput.value = bridgeUrl
  autoDetectOn = await getAutoDetect()
  autoDetectInput.checked = autoDetectOn
  if (autoDetectOn && bridgeUrl) {
    startAutoDetect()
  } else if (autoDetectOn && !bridgeUrl) {
    autoDetectOn = false
    autoDetectInput.checked = false
    autoStatus.textContent = 'Set the bridge URL to enable auto-detect.'
  }

  if (!even) {
    status.textContent = 'Running outside the Even runtime — browser preview only.'
    await paint()
    return
  }

  status.textContent = 'Glasses connected. Load a song to begin.'
  even.onTap(onTap)
  even.onSwipe(onSwipe)
  even.onDoubleTap(onDoubleTap)
  even.onForeground(() => { void paint() })

  // Start a render loop even before a song loads, so the dev preview / state
  // log emits regular ticks the regression script can latch onto.
  if (!renderTimer) renderTimer = setInterval(() => void paint(), RENDER_TICK_MS)

  await paint()
}

void bootstrap().catch(err => {
  // eslint-disable-next-line no-console
  console.error('[lyricsglow] bootstrap threw:', err?.message ?? err, err?.stack)
})
