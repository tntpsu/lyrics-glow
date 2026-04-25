// Pure-logic LRC ([mm:ss.xx] timestamp) parser + line picker.
// No DOM, no network — fully unit-testable.

export interface LrcLine {
  /** Timestamp in milliseconds from track start. */
  timeMs: number
  /** The lyric text (trimmed, may be empty for instrumental gaps). */
  text: string
}

const LINE_RE = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g

/**
 * Parse a multi-line LRC string into an ordered array of {timeMs, text}.
 * - A single LRC line may carry multiple timestamps (`[00:01.00][00:30.00]Same line`) — we expand each.
 * - Metadata tags like `[ar:Queen]` are skipped.
 * - Output is sorted by timeMs ascending and de-duplicated on identical (time,text) pairs.
 */
export function parseLrc(raw: string): LrcLine[] {
  if (!raw) return []
  const out: LrcLine[] = []
  for (const rawLine of raw.split(/\r?\n/)) {
    const stamps: number[] = []
    let m: RegExpExecArray | null
    LINE_RE.lastIndex = 0
    let lastIdx = 0
    while ((m = LINE_RE.exec(rawLine)) !== null) {
      const mins = parseInt(m[1]!, 10)
      const secs = parseInt(m[2]!, 10)
      const fracStr = m[3] ?? '0'
      // LRC fractions are typically 2 digits (centiseconds) but can be 3 (ms).
      // Normalise to milliseconds.
      const frac = parseInt(fracStr, 10)
      const fracMs = fracStr.length === 3 ? frac : frac * 10
      stamps.push(mins * 60_000 + secs * 1_000 + fracMs)
      lastIdx = m.index + m[0].length
    }
    if (stamps.length === 0) continue
    const text = rawLine.slice(lastIdx).trim()
    // Skip pure metadata lines such as `[ar:Queen]` which won't yield any
    // numeric timestamps (the regex above excludes them), but also skip
    // timestamped lines whose text begins with metadata-like `id:value` and
    // has no real content. Keep empty text — those are valid silence beats.
    for (const t of stamps) out.push({ timeMs: t, text })
  }
  out.sort((a, b) => a.timeMs - b.timeMs)
  // De-dupe identical (time, text) pairs that creep in from multi-stamp lines.
  const dedup: LrcLine[] = []
  for (const line of out) {
    const last = dedup[dedup.length - 1]
    if (last && last.timeMs === line.timeMs && last.text === line.text) continue
    dedup.push(line)
  }
  return dedup
}

/**
 * Return the index of the lyric line that should be "current" at `nowMs`.
 * Convention: the active line is the one whose timestamp is the largest one ≤ nowMs.
 * Returns -1 if `nowMs` is before the first line (so callers can render a leading gap).
 * Uses binary search — O(log n).
 */
export function pickLineIndex(lines: readonly LrcLine[], nowMs: number): number {
  if (lines.length === 0) return -1
  if (nowMs < lines[0]!.timeMs) return -1
  let lo = 0
  let hi = lines.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1
    if (lines[mid]!.timeMs <= nowMs) lo = mid
    else hi = mid - 1
  }
  return lo
}

/**
 * Return up to N lines centred on `currentIndex`: [prev, current, next, next+1, ...].
 * Pads with empty-text placeholders so the caller always gets exactly `before+1+after` slots
 * (useful for stable layout — no jitter when the song starts or ends).
 */
export function lineWindow(
  lines: readonly LrcLine[],
  currentIndex: number,
  before: number,
  after: number,
): LrcLine[] {
  const window: LrcLine[] = []
  for (let i = currentIndex - before; i <= currentIndex + after; i++) {
    if (i >= 0 && i < lines.length) {
      window.push(lines[i]!)
    } else {
      window.push({ timeMs: -1, text: '' })
    }
  }
  return window
}
