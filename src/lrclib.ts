// LRCLIB client. Public CORS-open API at https://lrclib.net — no key required.
// Returns either time-synced (LRC string) or plain (string) lyrics.

export interface LrclibTrack {
  /** LRCLIB-internal id of the matched record (informational only). */
  id: number
  /** Track title as LRCLIB has it. */
  trackName: string
  /** Artist name as LRCLIB has it. */
  artistName: string
  /** Track duration in seconds (LRCLIB's metadata, not always present). */
  duration: number | null
  /** Time-synced LRC string, or null if only plain lyrics exist. */
  syncedLyrics: string | null
  /** Untimed plain text fallback. */
  plainLyrics: string | null
}

export type LrclibResult =
  | { ok: true; track: LrclibTrack }
  | { ok: false; status: 'not-found' | 'network' | 'http'; detail?: string }

export interface LrclibQuery {
  artistName: string
  trackName: string
  /** Optional album hint — improves match accuracy. */
  albumName?: string
  /** Optional duration hint in seconds — disambiguates remixes / live versions. */
  duration?: number
}

const BASE = 'https://lrclib.net'
const FETCH_TIMEOUT_MS = 8_000

// v0.2.1: fetch-log hook so the phone-side debug panel can show every
// LRCLIB call's URL, status, latency, and any error. Same pattern as
// Glance v0.5.1 + Cue v0.3.4. Decoupled — main.ts wires the buffer.
export interface LyricsFetchLog {
  ts: number
  url: string
  via: 'lrclib' | 'phils-bridge'
  status: number | null
  ms: number
  ok: boolean
  error?: string
}
let logSink: ((entry: LyricsFetchLog) => void) | null = null
export function setLyricsLogger(sink: ((entry: LyricsFetchLog) => void) | null): void {
  logSink = sink
}

/**
 * Look up lyrics for a single (artist, track) pair. Wraps the GET /api/get endpoint.
 * Returns a tagged-union result so callers can render errors without try/catch sprawl.
 */
export async function fetchLyrics(query: LrclibQuery): Promise<LrclibResult> {
  if (!query.artistName.trim() || !query.trackName.trim()) {
    return { ok: false, status: 'not-found', detail: 'Need both artist and track name' }
  }
  const params = new URLSearchParams({
    artist_name: query.artistName.trim(),
    track_name: query.trackName.trim(),
  })
  if (query.albumName?.trim()) params.set('album_name', query.albumName.trim())
  if (query.duration && query.duration > 0) params.set('duration', String(Math.round(query.duration)))

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  const url = `${BASE}/api/get?${params.toString()}`
  const startedAt = Date.now()
  try {
    const resp = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    })
    if (resp.status === 404) {
      logSink?.({ ts: startedAt, url, via: 'lrclib', status: 404, ms: Date.now() - startedAt, ok: false, error: 'not found' })
      return { ok: false, status: 'not-found' }
    }
    if (!resp.ok) {
      logSink?.({ ts: startedAt, url, via: 'lrclib', status: resp.status, ms: Date.now() - startedAt, ok: false, error: `HTTP ${resp.status}` })
      return { ok: false, status: 'http', detail: `HTTP ${resp.status}` }
    }
    const json = (await resp.json()) as Partial<LrclibTrack> & {
      // LRCLIB sometimes returns these alternate cases — normalise below.
      name?: string
    }
    const track: LrclibTrack = {
      id: json.id ?? 0,
      trackName: json.trackName ?? json.name ?? query.trackName.trim(),
      artistName: json.artistName ?? query.artistName.trim(),
      duration: typeof json.duration === 'number' ? json.duration : null,
      syncedLyrics: json.syncedLyrics ?? null,
      plainLyrics: json.plainLyrics ?? null,
    }
    logSink?.({ ts: startedAt, url, via: 'lrclib', status: resp.status, ms: Date.now() - startedAt, ok: true })
    return { ok: true, track }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logSink?.({ ts: startedAt, url, via: 'lrclib', status: null, ms: Date.now() - startedAt, ok: false, error: msg })
    return { ok: false, status: 'network', detail: msg }
  } finally {
    clearTimeout(timer)
  }
}
