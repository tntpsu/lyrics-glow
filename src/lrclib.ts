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
  try {
    const resp = await fetch(`${BASE}/api/get?${params.toString()}`, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    })
    if (resp.status === 404) {
      return { ok: false, status: 'not-found' }
    }
    if (!resp.ok) {
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
    return { ok: true, track }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, status: 'network', detail: msg }
  } finally {
    clearTimeout(timer)
  }
}
