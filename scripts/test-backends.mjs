#!/usr/bin/env node
// Integration test against LRCLIB + (optionally) phils-bridge.
//
// Run:
//   node scripts/test-backends.mjs

import { existsSync, readFileSync } from 'node:fs'

function loadDotEnv(path) {
  if (!existsSync(path)) return {}
  const env = {}
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m) env[m[1]] = m[2].trim()
  }
  return env
}

const env = { ...process.env, ...loadDotEnv('.env.local') }

const PASS = []
const FAIL = []
const SKIPPED = []
function ok(name, detail = '') { console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`); PASS.push(name) }
function fail(name, detail) { console.log(`  ✗ ${name} — ${detail}`); FAIL.push({ name, detail }) }
function skip(name, why) { console.log(`  - ${name} (skipped: ${why})`); SKIPPED.push(name) }

async function probe(label, url, opts = {}) {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), opts.timeout ?? 8_000)
    const res = await fetch(url, { signal: ctrl.signal })
    clearTimeout(timer)
    if (!res.ok) { fail(label, `HTTP ${res.status}`); return null }
    if (opts.json) return { res, body: await res.json() }
    return { res, text: await res.text() }
  } catch (err) {
    fail(label, err instanceof Error ? err.message : String(err))
    return null
  }
}

console.log('Lyrics-Glow backend integration tests')
console.log()

// 1. LRCLIB returns time-synced lyrics for a known canonical track
{
  const url = 'https://lrclib.net/api/get?artist_name=Queen&track_name=Bohemian+Rhapsody'
  const r = await probe('LRCLIB has Bohemian Rhapsody', url, { json: true })
  if (r) {
    const synced = r.body?.syncedLyrics
    if (typeof synced !== 'string' || synced.length < 50) {
      fail('LRCLIB synced shape', 'syncedLyrics missing or too short')
    } else if (!/\[\d{1,2}:\d{2}\.\d+\]/.test(synced)) {
      fail('LRCLIB LRC format', 'no [mm:ss.xx] timestamps found')
    } else {
      ok('LRCLIB has Bohemian Rhapsody', `synced ${synced.length} chars`)
    }
  }
}

// 2. LRCLIB returns 404 for nonsense (so the plugin's "not-found" branch is exercisable)
{
  const url = 'https://lrclib.net/api/get?artist_name=NoSuchArtist&track_name=NoSuchSong_xkv9'
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 8_000)
    const r = await fetch(url, { signal: ctrl.signal })
    clearTimeout(timer)
    if (r.status === 404) ok('LRCLIB returns 404 for unknown track')
    else fail('LRCLIB 404 path', `expected 404, got ${r.status}`)
  } catch (err) {
    fail('LRCLIB 404 path', err instanceof Error ? err.message : String(err))
  }
}

// 3. CORS — LRCLIB advertises Access-Control-Allow-Origin: * so the
// glasses WebView fetch works without a proxy. Verify the header still
// lands so we don't get a regression.
{
  const url = 'https://lrclib.net/api/get?artist_name=Queen&track_name=Bohemian+Rhapsody'
  try {
    const r = await fetch(url)
    const acao = r.headers.get('access-control-allow-origin')
    if (acao) ok('LRCLIB CORS header present', acao)
    else fail('LRCLIB CORS', 'no Access-Control-Allow-Origin')
  } catch (err) {
    fail('LRCLIB CORS', err instanceof Error ? err.message : String(err))
  }
}

// 4. phils-bridge /now-playing.json (used by v0.2.0 auto-detect)
// Optional — depends on user having configured the bridge URL locally.
{
  // Try common defaults; skip if neither responds.
  const candidates = [
    'http://100.70.251.22:8790/now-playing.json',
    'http://10.168.168.105:8790/now-playing.json',
  ]
  let found = false
  for (const url of candidates) {
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 3_000)
      const r = await fetch(url, { signal: ctrl.signal })
      clearTimeout(timer)
      if (r.ok) {
        const body = await r.json()
        if ('playing' in body && (typeof body.positionMs === 'number' || body.positionMs === null || body.positionMs === undefined)) {
          ok('phils-bridge /now-playing.json contract', `playing=${body.playing}`)
        } else {
          fail('phils-bridge /now-playing.json contract', `bad shape: ${JSON.stringify(body).slice(0, 80)}`)
        }
        found = true
        break
      }
    } catch {
      // try next
    }
  }
  if (!found) skip('phils-bridge /now-playing.json contract', 'bridge unreachable on default LAN/Tailscale URLs')
}

console.log()
console.log(`Result: ${PASS.length} passed, ${FAIL.length} failed, ${SKIPPED.length} skipped`)
if (FAIL.length > 0) {
  console.log('Failures:')
  for (const f of FAIL) console.log(`  - ${f.name}: ${f.detail}`)
  process.exit(1)
}
