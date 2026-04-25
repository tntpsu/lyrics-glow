// Unit tests for the now-playing client. fetch is mocked.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchNowPlaying, trackKey } from '../src/now-playing'

const ORIGINAL_FETCH = globalThis.fetch

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH
  vi.restoreAllMocks()
})

describe('fetchNowPlaying', () => {
  it('returns unconfigured when bridge URL is blank', async () => {
    const r = await fetchNowPlaying('   ')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe('unconfigured')
  })

  it('hits /now-playing.json on the bridge URL and parses the playing payload', async () => {
    let captured = ''
    globalThis.fetch = vi.fn(async (url: string) => {
      captured = url
      return new Response(
        JSON.stringify({
          status: 'ok',
          playing: true,
          track: 'Bohemian Rhapsody',
          artist: 'Queen',
          source: 'Spotify',
          positionMs: 12500,
          durationMs: 354000,
          fetchedAt: '2026-04-25T12:00:00Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }) as unknown as typeof fetch
    const r = await fetchNowPlaying('http://10.0.0.1:8790/')
    expect(captured).toBe('http://10.0.0.1:8790/now-playing.json')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.track.playing).toBe(true)
      expect(r.track.track).toBe('Bohemian Rhapsody')
      expect(r.track.artist).toBe('Queen')
      expect(r.track.positionMs).toBe(12500)
    }
  })

  it('parses paused/idle payload', async () => {
    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify({ status: 'ok', playing: false }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )) as unknown as typeof fetch
    const r = await fetchNowPlaying('http://x/')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.track.playing).toBe(false)
  })

  it('maps non-2xx to http error', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 502 })) as unknown as typeof fetch
    const r = await fetchNowPlaying('http://x/')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.status).toBe('http')
      expect(r.detail).toMatch(/502/)
    }
  })

  it('maps fetch throw to network error', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    const r = await fetchNowPlaying('http://x/')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.status).toBe('network')
      expect(r.detail).toMatch(/Failed to fetch/)
    }
  })

  it('handles missing optional fields gracefully', async () => {
    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify({ status: 'ok', playing: true, track: 'Anon', artist: 'Unknown' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )) as unknown as typeof fetch
    const r = await fetchNowPlaying('http://x/')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.track.positionMs).toBeNull()
      expect(r.track.durationMs).toBeNull()
    }
  })
})

describe('trackKey', () => {
  it('returns empty string when not playing', () => {
    expect(trackKey({ playing: false })).toBe('')
  })

  it('lowercases track + artist for stable comparison', () => {
    expect(trackKey({ playing: true, track: 'Bohemian Rhapsody', artist: 'Queen' }))
      .toBe('bohemian rhapsody|queen')
  })

  it('treats missing fields as empty for the key', () => {
    expect(trackKey({ playing: true, track: 'Foo' })).toBe('foo|')
  })

  it('produces different keys for different tracks', () => {
    const a = trackKey({ playing: true, track: 'Hey Jude', artist: 'Beatles' })
    const b = trackKey({ playing: true, track: 'Yesterday', artist: 'Beatles' })
    expect(a).not.toBe(b)
  })
})
