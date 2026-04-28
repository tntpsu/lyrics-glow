// Tests for the PKCE primitives + URL helpers in src/spotify.ts.
// Network-dependent paths (token exchange, currently-playing fetch) are
// covered with mocked fetch, since they're pure HTTP shape tests.

// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildAuthorizeUrl,
  clearAuthCodeFromUrl,
  codeChallenge,
  exchangeCodeForTokens,
  fetchCurrentlyPlaying,
  generateCodeVerifier,
  readAuthCodeFromUrl,
  refreshTokens,
} from '../src/spotify'

const ORIGINAL_FETCH = globalThis.fetch
afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH
  vi.restoreAllMocks()
})

describe('PKCE primitives', () => {
  it('generateCodeVerifier produces a string of valid chars', () => {
    const v = generateCodeVerifier(64)
    expect(v).toHaveLength(64)
    expect(v).toMatch(/^[A-Za-z0-9\-._~]+$/)
  })

  it('generateCodeVerifier is non-deterministic', () => {
    const a = generateCodeVerifier()
    const b = generateCodeVerifier()
    expect(a).not.toBe(b)
  })

  it('codeChallenge is deterministic for the same verifier', async () => {
    const v = 'fixedverifier123abcDEF-._~'
    const a = await codeChallenge(v)
    const b = await codeChallenge(v)
    expect(a).toBe(b)
    // Should be base64url (no padding, no +/)
    expect(a).toMatch(/^[A-Za-z0-9\-_]+$/)
  })
})

describe('buildAuthorizeUrl', () => {
  it('contains all required PKCE + scope params', async () => {
    const v = generateCodeVerifier()
    const url = await buildAuthorizeUrl(
      { clientId: 'abc123', redirectUri: 'http://localhost:5173/' },
      v,
    )
    expect(url).toContain('https://accounts.spotify.com/authorize')
    expect(url).toContain('response_type=code')
    expect(url).toContain('client_id=abc123')
    expect(url).toContain('code_challenge_method=S256')
    expect(url).toContain('scope=user-read-currently-playing+user-read-playback-state')
    expect(url).toContain('redirect_uri=http%3A%2F%2Flocalhost%3A5173%2F')
  })
})

describe('readAuthCodeFromUrl / clearAuthCodeFromUrl', () => {
  it('reads ?code from current URL', () => {
    window.history.replaceState({}, '', '/?code=ABCDEF&other=keep')
    expect(readAuthCodeFromUrl()).toBe('ABCDEF')
  })

  it('returns null when ?code missing', () => {
    window.history.replaceState({}, '', '/?other=keep')
    expect(readAuthCodeFromUrl()).toBe(null)
  })

  it('clearAuthCodeFromUrl strips code + state but preserves other params', () => {
    window.history.replaceState({}, '', '/?code=ABC&state=xyz&keep=1')
    clearAuthCodeFromUrl()
    expect(window.location.search).toBe('?keep=1')
  })
})

describe('exchangeCodeForTokens', () => {
  it('POSTs the right form-encoded body to /api/token', async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({
        access_token: 'AT', refresh_token: 'RT', expires_in: 3600,
        token_type: 'Bearer', scope: 'user-read-currently-playing',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    const tokens = await exchangeCodeForTokens('CODE', 'VER', 'CID', 'http://x/')
    expect(tokens.accessToken).toBe('AT')
    expect(tokens.refreshToken).toBe('RT')
    expect(tokens.expiresAt).toBeGreaterThan(Date.now())
    const [, init] = fetchSpy.mock.calls[0]!
    const body = (init?.body as URLSearchParams).toString()
    expect(body).toContain('grant_type=authorization_code')
    expect(body).toContain('code=CODE')
    expect(body).toContain('code_verifier=VER')
    expect(body).toContain('client_id=CID')
  })

  it('throws on non-ok response', async () => {
    globalThis.fetch = vi.fn(async () => new Response('bad', { status: 400 })) as unknown as typeof fetch
    await expect(
      exchangeCodeForTokens('CODE', 'VER', 'CID', 'http://x/'),
    ).rejects.toThrow(/400/)
  })
})

describe('refreshTokens', () => {
  it('preserves existing refresh_token if Spotify omits it from the response', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({
        access_token: 'NEW_AT', expires_in: 3600,
        // No refresh_token in response (Spotify often omits)
        token_type: 'Bearer', scope: '',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    ) as unknown as typeof fetch
    const next = await refreshTokens('OLD_RT', 'CID')
    expect(next.accessToken).toBe('NEW_AT')
    expect(next.refreshToken).toBe('OLD_RT') // preserved
  })
})

describe('fetchCurrentlyPlaying', () => {
  it('returns nothing-playing on HTTP 204', async () => {
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch
    const r = await fetchCurrentlyPlaying('AT')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe('nothing-playing')
  })

  it('returns unauthorized on HTTP 401', async () => {
    globalThis.fetch = vi.fn(async () => new Response('expired', { status: 401 })) as unknown as typeof fetch
    const r = await fetchCurrentlyPlaying('AT')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe('unauthorized')
  })

  it('parses a normal currently-playing response', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({
        is_playing: true,
        progress_ms: 12345,
        item: {
          name: 'Song',
          duration_ms: 234567,
          artists: [{ name: 'Artist A' }, { name: 'Artist B' }],
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    ) as unknown as typeof fetch
    const r = await fetchCurrentlyPlaying('AT')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.track.playing).toBe(true)
      expect(r.track.track).toBe('Song')
      expect(r.track.artist).toBe('Artist A, Artist B')
      expect(r.track.source).toBe('Spotify')
      expect(r.track.positionMs).toBe(12345)
    }
  })

  it('returns nothing-playing when item is null (Spotify connected but inactive)', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ is_playing: false, progress_ms: null, item: null }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }),
    ) as unknown as typeof fetch
    const r = await fetchCurrentlyPlaying('AT')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe('nothing-playing')
  })
})
