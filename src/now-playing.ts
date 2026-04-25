// Auto-detect what's playing on the user's Mac (Music or Spotify desktop apps)
// by polling the phils-bridge `/now-playing.json` endpoint.
//
// The bridge runs AppleScript locally to query the running music apps —
// no Spotify OAuth required, no dev app, nothing to set up beyond pasting
// the bridge URL into the lyrics-glow phone settings.
//
// Limitation: this only catches music playing on the Mac. iPhone Spotify
// playback isn't visible to AppleScript; that requires Spotify Web API
// + OAuth, which is the v0.3 path.

export interface NowPlayingTrack {
  /** True if a track is actively playing right now. */
  playing: boolean
  track?: string
  artist?: string
  /** "Music" | "Spotify" — informational only. */
  source?: string
  /** Current playback position in milliseconds, when the bridge can read it. */
  positionMs?: number | null
  /** Total track duration in milliseconds, when known. */
  durationMs?: number | null
  /** ISO timestamp when the bridge captured this snapshot — used to
   *  compensate for network + processing latency when anchoring our
   *  local karaoke clock. */
  fetchedAt?: string
}

export type NowPlayingResult =
  | { ok: true; track: NowPlayingTrack }
  | { ok: false; status: 'unconfigured' | 'network' | 'http'; detail?: string }

const FETCH_TIMEOUT_MS = 4_000

export async function fetchNowPlaying(bridgeUrl: string): Promise<NowPlayingResult> {
  const base = bridgeUrl.trim().replace(/\/$/, '')
  if (!base) return { ok: false, status: 'unconfigured', detail: 'bridge URL is blank' }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const resp = await fetch(`${base}/now-playing.json`, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    })
    if (!resp.ok) return { ok: false, status: 'http', detail: `HTTP ${resp.status}` }
    const json = (await resp.json()) as Partial<NowPlayingTrack> & { status?: string }
    return {
      ok: true,
      track: {
        playing: !!json.playing,
        track: json.track,
        artist: json.artist,
        source: json.source,
        positionMs: typeof json.positionMs === 'number' ? json.positionMs : null,
        durationMs: typeof json.durationMs === 'number' ? json.durationMs : null,
        fetchedAt: json.fetchedAt,
      },
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, status: 'network', detail: msg }
  } finally {
    clearTimeout(timer)
  }
}

/** Stable identity string for a (track, artist) pair so a poller can detect
 *  track changes cheaply without comparing all fields. */
export function trackKey(t: NowPlayingTrack): string {
  if (!t.playing) return ''
  return `${(t.track ?? '').toLowerCase()}|${(t.artist ?? '').toLowerCase()}`
}
