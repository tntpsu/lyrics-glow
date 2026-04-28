// Spotify Web API integration via Authorization Code + PKCE.
// Pure browser-side — no client secret, no proxy server. Works inside the
// Even Hub WebView once the user has completed the one-time OAuth dance.
//
// What this lets us do that phils-bridge cannot:
//   - Detect playback on the user's iPhone (or any device they're logged
//     into Spotify on), not just the Mac running phils-bridge
//   - Ship a saleable product: each user creates their own Spotify dev
//     app and pastes a Client ID; no server-side infrastructure.
//
// Limitation: requires the user to (a) have a Spotify account, (b) create
// a free Spotify dev app, (c) paste the Client ID. Apple Music isn't
// covered. phils-bridge stays as the fallback for power users.

import type { NowPlayingTrack } from './now-playing'

const AUTH_BASE = 'https://accounts.spotify.com/authorize'
const TOKEN_BASE = 'https://accounts.spotify.com/api/token'
const API_BASE = 'https://api.spotify.com/v1'
const SCOPE = 'user-read-currently-playing user-read-playback-state'

export interface SpotifyTokens {
  accessToken: string
  refreshToken: string
  /** Wall-clock ms (Date.now) when the access token expires. */
  expiresAt: number
}

// ─── PKCE primitives ────────────────────────────────────────────────

function base64UrlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let str = ''
  for (let i = 0; i < buf.byteLength; i++) str += String.fromCharCode(buf[i]!)
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function generateCodeVerifier(length = 64): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < length; i++) out += chars[bytes[i]! % chars.length]
  return out
}

export async function codeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return base64UrlEncode(digest)
}

// ─── Authorize flow ─────────────────────────────────────────────────

export interface AuthorizeRequest {
  clientId: string
  redirectUri: string
}

export async function buildAuthorizeUrl(req: AuthorizeRequest, verifier: string): Promise<string> {
  const challenge = await codeChallenge(verifier)
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: req.clientId,
    redirect_uri: req.redirectUri,
    scope: SCOPE,
    code_challenge_method: 'S256',
    code_challenge: challenge,
  })
  return `${AUTH_BASE}?${params.toString()}`
}

/** Read `code` query-string param from the current URL (set by Spotify
 *  on redirect after user approves). Returns null if absent. */
export function readAuthCodeFromUrl(): string | null {
  const url = new URL(window.location.href)
  return url.searchParams.get('code')
}

/** Strip the `code` and `state` params from the URL bar after exchanging,
 *  so a refresh doesn't try to re-exchange a stale code. */
export function clearAuthCodeFromUrl(): void {
  const url = new URL(window.location.href)
  url.searchParams.delete('code')
  url.searchParams.delete('state')
  window.history.replaceState({}, '', url.toString())
}

// ─── Token exchange + refresh ───────────────────────────────────────

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  token_type: string
  scope: string
}

export async function exchangeCodeForTokens(
  code: string,
  verifier: string,
  clientId: string,
  redirectUri: string,
): Promise<SpotifyTokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier,
  })
  const resp = await fetch(TOKEN_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '')
    throw new Error(`Spotify token exchange failed: ${resp.status} ${txt.slice(0, 120)}`)
  }
  const json = (await resp.json()) as TokenResponse
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? '',
    expiresAt: Date.now() + json.expires_in * 1000,
  }
}

export async function refreshTokens(
  refreshToken: string,
  clientId: string,
): Promise<SpotifyTokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  })
  const resp = await fetch(TOKEN_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '')
    throw new Error(`Spotify token refresh failed: ${resp.status} ${txt.slice(0, 120)}`)
  }
  const json = (await resp.json()) as TokenResponse
  return {
    accessToken: json.access_token,
    // Spotify sometimes rotates the refresh token; sometimes doesn't.
    refreshToken: json.refresh_token ?? refreshToken,
    expiresAt: Date.now() + json.expires_in * 1000,
  }
}

// ─── Currently-playing fetch ────────────────────────────────────────

interface CurrentlyPlayingResponse {
  is_playing: boolean
  progress_ms: number | null
  item: {
    name: string
    duration_ms: number
    artists: Array<{ name: string }>
  } | null
}

export type SpotifyResult =
  | { ok: true; track: NowPlayingTrack }
  | { ok: false; status: 'unconfigured' | 'unauthorized' | 'network' | 'http' | 'nothing-playing'; detail?: string }

/** Fetch currently-playing. Returns nothing-playing on 204. Caller is
 *  responsible for token refresh when {status: 'unauthorized'}. */
export async function fetchCurrentlyPlaying(accessToken: string): Promise<SpotifyResult> {
  if (!accessToken) return { ok: false, status: 'unconfigured' }
  try {
    const resp = await fetch(`${API_BASE}/me/player/currently-playing`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (resp.status === 204) return { ok: false, status: 'nothing-playing' }
    if (resp.status === 401) return { ok: false, status: 'unauthorized' }
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '')
      return { ok: false, status: 'http', detail: `HTTP ${resp.status} ${txt.slice(0, 80)}` }
    }
    const json = (await resp.json()) as CurrentlyPlayingResponse
    if (!json.item) return { ok: false, status: 'nothing-playing' }
    return {
      ok: true,
      track: {
        playing: !!json.is_playing,
        track: json.item.name,
        artist: json.item.artists.map(a => a.name).join(', '),
        source: 'Spotify',
        positionMs: typeof json.progress_ms === 'number' ? json.progress_ms : null,
        durationMs: json.item.duration_ms,
        fetchedAt: new Date().toISOString(),
      },
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, status: 'network', detail: msg }
  }
}

/** Fetch + auto-refresh on 401. Mutates `tokens` to the refreshed values
 *  and calls `onRefresh` so the caller can persist them. Returns the
 *  same SpotifyResult shape as fetchCurrentlyPlaying. */
export async function fetchCurrentlyPlayingWithRefresh(
  tokens: SpotifyTokens,
  clientId: string,
  onRefresh: (next: SpotifyTokens) => Promise<void>,
): Promise<SpotifyResult> {
  // Pre-emptive refresh if we know the token is about to expire.
  if (Date.now() >= tokens.expiresAt - 30_000 && tokens.refreshToken) {
    try {
      const next = await refreshTokens(tokens.refreshToken, clientId)
      tokens.accessToken = next.accessToken
      tokens.refreshToken = next.refreshToken
      tokens.expiresAt = next.expiresAt
      await onRefresh(next)
    } catch {
      // fall through — let the request fail with 401 if expired.
    }
  }
  let result = await fetchCurrentlyPlaying(tokens.accessToken)
  if (result.ok === false && result.status === 'unauthorized' && tokens.refreshToken) {
    try {
      const next = await refreshTokens(tokens.refreshToken, clientId)
      tokens.accessToken = next.accessToken
      tokens.refreshToken = next.refreshToken
      tokens.expiresAt = next.expiresAt
      await onRefresh(next)
      result = await fetchCurrentlyPlaying(tokens.accessToken)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, status: 'unauthorized', detail: `refresh failed: ${msg.slice(0, 80)}` }
    }
  }
  return result
}
