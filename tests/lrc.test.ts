// Unit tests for the pure-logic LRC parser + line picker.
// No DOM, no network — these run fast in vitest's default node env.

import { describe, expect, it } from 'vitest'
import { parseLrc, pickLineIndex, lineWindow } from '../src/lrc'

describe('parseLrc', () => {
  it('returns [] for empty/null input', () => {
    expect(parseLrc('')).toEqual([])
  })

  it('parses standard [mm:ss.xx] timestamps with centisecond fractions', () => {
    const raw = `[00:00.15] Is this the real life?
[00:07.13] Caught in a landslide
[00:14.77] Open your eyes`
    const lines = parseLrc(raw)
    expect(lines).toHaveLength(3)
    expect(lines[0]).toEqual({ timeMs: 150, text: 'Is this the real life?' })
    expect(lines[1]).toEqual({ timeMs: 7_130, text: 'Caught in a landslide' })
    expect(lines[2]).toEqual({ timeMs: 14_770, text: 'Open your eyes' })
  })

  it('handles 3-digit fractional milliseconds', () => {
    const lines = parseLrc('[00:01.500]half a sec in')
    expect(lines).toEqual([{ timeMs: 1_500, text: 'half a sec in' }])
  })

  it('expands multi-stamp lines (same lyric repeats at multiple times)', () => {
    const raw = '[00:01.00][00:30.00][01:00.00]Hey'
    const lines = parseLrc(raw)
    expect(lines).toEqual([
      { timeMs: 1_000, text: 'Hey' },
      { timeMs: 30_000, text: 'Hey' },
      { timeMs: 60_000, text: 'Hey' },
    ])
  })

  it('skips metadata-only lines like [ar:Queen]', () => {
    const raw = `[ar:Queen]
[ti:Bohemian Rhapsody]
[00:00.10] real lyric`
    const lines = parseLrc(raw)
    expect(lines).toEqual([{ timeMs: 100, text: 'real lyric' }])
  })

  it('preserves empty-text instrumental gaps', () => {
    const raw = `[00:00.00] verse
[00:30.00]
[01:00.00] chorus`
    const lines = parseLrc(raw)
    expect(lines).toHaveLength(3)
    expect(lines[1]?.text).toBe('')
  })

  it('sorts unsorted input', () => {
    const raw = `[00:30.00] second
[00:10.00] first
[01:00.00] third`
    const lines = parseLrc(raw)
    expect(lines.map(l => l.timeMs)).toEqual([10_000, 30_000, 60_000])
  })

  it('de-duplicates identical (time, text) pairs', () => {
    // Multi-stamp + identical line in source — should not produce duplicates.
    const raw = `[00:01.00]Hey
[00:01.00]Hey`
    const lines = parseLrc(raw)
    expect(lines).toEqual([{ timeMs: 1_000, text: 'Hey' }])
  })
})

describe('pickLineIndex', () => {
  const lines = [
    { timeMs: 1_000, text: 'a' },
    { timeMs: 2_000, text: 'b' },
    { timeMs: 5_000, text: 'c' },
    { timeMs: 9_000, text: 'd' },
  ]

  it('returns -1 when nowMs is before first line', () => {
    expect(pickLineIndex(lines, 0)).toBe(-1)
    expect(pickLineIndex(lines, 999)).toBe(-1)
  })

  it('returns 0 exactly at first timestamp', () => {
    expect(pickLineIndex(lines, 1_000)).toBe(0)
  })

  it('returns the largest line whose time ≤ nowMs', () => {
    expect(pickLineIndex(lines, 1_500)).toBe(0)
    expect(pickLineIndex(lines, 2_000)).toBe(1)
    expect(pickLineIndex(lines, 2_001)).toBe(1)
    expect(pickLineIndex(lines, 4_999)).toBe(1)
    expect(pickLineIndex(lines, 5_000)).toBe(2)
    expect(pickLineIndex(lines, 8_999)).toBe(2)
    expect(pickLineIndex(lines, 9_000)).toBe(3)
  })

  it('clamps to the last line when nowMs is past the song end', () => {
    expect(pickLineIndex(lines, 60_000)).toBe(3)
  })

  it('returns -1 for empty input', () => {
    expect(pickLineIndex([], 1_000)).toBe(-1)
  })
})

describe('lineWindow', () => {
  const lines = [
    { timeMs: 0, text: 'a' },
    { timeMs: 1, text: 'b' },
    { timeMs: 2, text: 'c' },
    { timeMs: 3, text: 'd' },
    { timeMs: 4, text: 'e' },
  ]

  it('returns a centred window of size before+1+after', () => {
    const w = lineWindow(lines, 2, 1, 1)
    expect(w.map(l => l.text)).toEqual(['b', 'c', 'd'])
  })

  it('pads leading gap with empty placeholders when current is near start', () => {
    const w = lineWindow(lines, 0, 2, 1)
    expect(w.map(l => l.text)).toEqual(['', '', 'a', 'b'])
  })

  it('pads trailing gap with empty placeholders when current is near end', () => {
    const w = lineWindow(lines, 4, 1, 2)
    expect(w.map(l => l.text)).toEqual(['d', 'e', '', ''])
  })

  it('returns an all-empty window for currentIndex=-1 (before first line)', () => {
    const w = lineWindow(lines, -1, 1, 1)
    expect(w.map(l => l.text)).toEqual(['', '', 'a'])
  })
})
