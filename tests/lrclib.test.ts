// Unit tests for the LRCLIB client. Mocks fetch to avoid hitting the
// real network — verifies request shape and result-tag mapping.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchLyrics } from '../src/lrclib'

const ORIGINAL_FETCH = globalThis.fetch

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH
  vi.restoreAllMocks()
})

describe('fetchLyrics', () => {
  it('returns not-found when artist or track is blank', async () => {
    const r1 = await fetchLyrics({ artistName: '', trackName: 'foo' })
    const r2 = await fetchLyrics({ artistName: 'foo', trackName: '   ' })
    expect(r1.ok).toBe(false)
    expect(r2.ok).toBe(false)
    if (!r1.ok) expect(r1.status).toBe('not-found')
    if (!r2.ok) expect(r2.status).toBe('not-found')
  })

  it('builds the correct query string and parses ok response', async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      expect(url).toContain('https://lrclib.net/api/get?')
      expect(url).toContain('artist_name=Queen')
      expect(url).toContain('track_name=Bohemian+Rhapsody')
      return new Response(
        JSON.stringify({
          id: 12345,
          trackName: 'Bohemian Rhapsody',
          artistName: 'Queen',
          duration: 354,
          syncedLyrics: '[00:00.10] Is this the real life?',
          plainLyrics: 'Is this the real life?',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    })
    globalThis.fetch = fetchSpy as unknown as typeof fetch
    const r = await fetchLyrics({ artistName: 'Queen', trackName: 'Bohemian Rhapsody' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.track.id).toBe(12345)
      expect(r.track.syncedLyrics).toContain('Is this the real life?')
      expect(r.track.duration).toBe(354)
    }
  })

  it('passes optional album and duration hints when supplied', async () => {
    let capturedUrl = ''
    globalThis.fetch = vi.fn(async (url: string) => {
      capturedUrl = url
      return new Response(JSON.stringify({ trackName: 't', artistName: 'a' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as unknown as typeof fetch
    await fetchLyrics({
      artistName: 'a',
      trackName: 't',
      albumName: 'A Night at the Opera',
      duration: 354,
    })
    expect(capturedUrl).toContain('album_name=A+Night+at+the+Opera')
    expect(capturedUrl).toContain('duration=354')
  })

  it('maps 404 to not-found', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch
    const r = await fetchLyrics({ artistName: 'x', trackName: 'y' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe('not-found')
  })

  it('maps non-404 non-2xx to http error', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 503 })) as unknown as typeof fetch
    const r = await fetchLyrics({ artistName: 'x', trackName: 'y' })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.status).toBe('http')
      expect(r.detail).toMatch(/503/)
    }
  })

  it('maps fetch throw to network error', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    const r = await fetchLyrics({ artistName: 'x', trackName: 'y' })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.status).toBe('network')
      expect(r.detail).toMatch(/Failed to fetch/)
    }
  })
})
