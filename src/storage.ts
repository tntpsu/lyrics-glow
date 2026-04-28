// Native localStorage wrapper. Same pattern as Cue/Glance — falls back to
// browser localStorage when running in the dev preview without an Even bridge.

interface BridgeStorageLike {
  getStorage: (key: string) => Promise<string>
  setStorage: (key: string, value: string) => Promise<boolean>
}

let bridge: BridgeStorageLike | null = null

export function setStorageBridge(b: BridgeStorageLike | null): void {
  bridge = b
}

async function readRaw(key: string): Promise<string | null> {
  try {
    if (bridge) {
      const v = await bridge.getStorage(key)
      return v || null
    }
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

async function writeRaw(key: string, value: string): Promise<void> {
  try {
    if (bridge) {
      await bridge.setStorage(key, value)
      return
    }
    window.localStorage.setItem(key, value)
  } catch {
    /* swallow — settings degrade to in-memory for the session */
  }
}

const KEY_ARTIST = 'lyricsglow:artist:v1'
const KEY_TRACK = 'lyricsglow:track:v1'
const KEY_OFFSET = 'lyricsglow:offset-ms:v1'
const KEY_BRIDGE_URL = 'lyricsglow:bridge-url:v1'
const KEY_AUTO_DETECT = 'lyricsglow:auto-detect:v1'
const KEY_SPOTIFY_CLIENT_ID = 'lyricsglow:spotify-client-id:v1'
const KEY_SPOTIFY_TOKENS = 'lyricsglow:spotify-tokens:v1'
// Stored only for the duration of an in-flight OAuth dance (until the
// callback round-trips), so we keep it as a plain key.
const KEY_SPOTIFY_VERIFIER = 'lyricsglow:spotify-verifier:v1'

export async function getLastSong(): Promise<{ artist: string; track: string }> {
  const a = (await readRaw(KEY_ARTIST)) ?? ''
  const t = (await readRaw(KEY_TRACK)) ?? ''
  return { artist: a, track: t }
}

export async function setLastSong(artist: string, track: string): Promise<void> {
  await writeRaw(KEY_ARTIST, artist.trim())
  await writeRaw(KEY_TRACK, track.trim())
}

export async function getOffsetMs(): Promise<number> {
  const raw = await readRaw(KEY_OFFSET)
  if (!raw) return 0
  const n = parseInt(raw, 10)
  return Number.isFinite(n) ? n : 0
}

export async function setOffsetMs(ms: number): Promise<void> {
  await writeRaw(KEY_OFFSET, String(Math.round(ms)))
}

export async function getBridgeUrl(): Promise<string> {
  return (await readRaw(KEY_BRIDGE_URL)) ?? ''
}

export async function setBridgeUrl(url: string): Promise<void> {
  await writeRaw(KEY_BRIDGE_URL, url.trim())
}

export async function getAutoDetect(): Promise<boolean> {
  return (await readRaw(KEY_AUTO_DETECT)) === '1'
}

export async function setAutoDetect(on: boolean): Promise<void> {
  await writeRaw(KEY_AUTO_DETECT, on ? '1' : '0')
}

// ─── Spotify OAuth ──────────────────────────────────────────────────

export interface SpotifyTokensStored {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

export async function getSpotifyClientId(): Promise<string> {
  return (await readRaw(KEY_SPOTIFY_CLIENT_ID)) ?? ''
}

export async function setSpotifyClientId(id: string): Promise<void> {
  await writeRaw(KEY_SPOTIFY_CLIENT_ID, id.trim())
}

export async function getSpotifyTokens(): Promise<SpotifyTokensStored | null> {
  const raw = await readRaw(KEY_SPOTIFY_TOKENS)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as SpotifyTokensStored
    if (typeof parsed.accessToken !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

export async function setSpotifyTokens(t: SpotifyTokensStored | null): Promise<void> {
  if (!t) {
    await writeRaw(KEY_SPOTIFY_TOKENS, '')
    return
  }
  await writeRaw(KEY_SPOTIFY_TOKENS, JSON.stringify(t))
}

export async function getSpotifyVerifier(): Promise<string> {
  return (await readRaw(KEY_SPOTIFY_VERIFIER)) ?? ''
}

export async function setSpotifyVerifier(v: string): Promise<void> {
  await writeRaw(KEY_SPOTIFY_VERIFIER, v.trim())
}
