// LyricsGlow — karaoke-through-glasses.
//
// v0.1.0 scope: phone-side song picker (artist + title) → LRCLIB lookup →
// 3-line karaoke window on glasses, advanced by a local 250ms tick against
// the LRC timestamps. Manual offset slider compensates for BLE+render lag.
// No Spotify auto-detect yet; that's v0.2.0 (needs phone-side bridge + OAuth).

import { connectEvenRuntime, type EvenRuntime, type InputSource, type SwipeDir } from './even'
import { fetchLyrics } from './lrclib'
import { lineWindow, parseLrc, pickLineIndex, type LrcLine } from './lrc'
import { getLastSong, getOffsetMs, setLastSong, setOffsetMs, setStorageBridge } from './storage'

const RENDER_TICK_MS = 250

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
offsetSlider.addEventListener('input', () => {
  offsetMs = parseInt(offsetSlider.value, 10) || 0
  offsetLabel.textContent = String(offsetMs)
  void setOffsetMs(offsetMs)
  void paint()
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
