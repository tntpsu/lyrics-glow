#!/usr/bin/env node
// End-to-end smoke test for Lyrics Glow via the Even Hub simulator HTTP API.
//
// Scope: this verifies the deterministic, offline-safe parts of the UX —
// boot completes, the 250ms render tick emits state logs, gestures with
// no song loaded don't crash. The song-loaded karaoke flow itself
// (LRCLIB lookup, time-sync line advance, swipe-bias, play/pause) is
// covered by the unit tests on lrc.ts and lrclib.ts (parser + binary
// search + fetch-mocked transport, 23 tests passing).
//
// Why not exercise the full karaoke flow here: the simulator's
// automation API only exposes ping/screenshot/console/input — no
// DOM-eval, no storage injection, no synthetic-network fixture. Loading
// a song would require a real LRCLIB call, making the test
// network-dependent and flaky in CI. The integration test for the full
// path is manual: `npm run dev`, open the simulator, type a song,
// hit Load, watch the karaoke window.
//
// Prereqs (run manually first):
//   1. cd ~/Documents/lyrics-glow && npm run dev          # Vite on :5177
//   2. npx evenhub-simulator --automation-port 9898 http://localhost:5177
//
// Then: npm run test:e2e

import { writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SIM_BASE = 'http://127.0.0.1:9898'
const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(HERE, '..', 'tests', 'screenshots-regression')

let lastConsoleId = -1
let pass = 0
let fail = 0
const failures = []

async function ping() {
  const r = await fetch(`${SIM_BASE}/api/ping`)
  if (!r.ok) throw new Error(`simulator not reachable on ${SIM_BASE}`)
}
async function input(action) {
  const r = await fetch(`${SIM_BASE}/api/input`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  })
  if (!r.ok) throw new Error(`input ${action} failed: ${r.status}`)
}
async function fetchConsoleEntries() {
  const r = await fetch(`${SIM_BASE}/api/console`)
  const body = await r.json()
  return body.entries ?? []
}
async function waitForState(predicate, { timeoutMs = 6_000, label } = {}) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const entries = await fetchConsoleEntries()
    const fresh = entries.filter(e => e.id > lastConsoleId)
    for (const e of fresh) {
      if (typeof e.message === 'string' && e.message.includes('[lyricsglow:state]') && predicate(e.message)) {
        lastConsoleId = e.id
        return e
      }
      if (e.id > lastConsoleId) lastConsoleId = e.id
    }
    await new Promise(r => setTimeout(r, 200))
  }
  throw new Error(`timed out waiting for state: ${label ?? '(unlabeled)'}`)
}
async function countStateLogs(durationMs) {
  // Sample over `durationMs`, return count of [lyricsglow:state] logs that
  // appeared during the window. Used to confirm the 250ms render tick is
  // alive (we expect ~4 per second). Snapshot the buffer's max id BEFORE
  // sleeping so we don't compete with `lastConsoleId` bookkeeping.
  const before = await fetchConsoleEntries()
  const startId = before.length > 0 ? before[before.length - 1].id : -1
  await new Promise(r => setTimeout(r, durationMs))
  const after = await fetchConsoleEntries()
  const fresh = after.filter(e => e.id > startId && typeof e.message === 'string' && e.message.includes('[lyricsglow:state]'))
  if (fresh.length > 0) lastConsoleId = Math.max(lastConsoleId, fresh[fresh.length - 1].id)
  return fresh.length
}
async function screenshot(name) {
  await mkdir(OUT_DIR, { recursive: true })
  const r = await fetch(`${SIM_BASE}/api/screenshot/glasses`)
  const buf = Buffer.from(await r.arrayBuffer())
  await writeFile(join(OUT_DIR, `${name}.png`), buf)
}
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`)
    pass += 1
  } else {
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
    failures.push(label)
    fail += 1
  }
}

async function main() {
  console.log('Lyrics Glow regression test (smoke)')
  console.log(`  simulator: ${SIM_BASE}`)
  console.log()

  await ping()
  // Reset lastConsoleId so we catch any state log that fires after this point.
  // If a tick has already fired in the past 250ms, waitForState will pick the
  // next one within the timeout regardless.
  const initial = await fetchConsoleEntries()
  if (initial.length > 0) lastConsoleId = initial[initial.length - 1].id

  console.log('1. App boots and idle-ticks')
  await screenshot('01-initial')
  const idle = await waitForState(
    m => m.includes('loaded=0') && m.includes('playing=0'),
    { label: 'idle ticking with no song loaded' },
  )
  check('app boots and idle ticks', idle.message.includes('loaded=0'), idle.message)

  console.log('2. Render loop keeps producing state logs (sample 3s, expect ≥2)')
  // The simulator's ShadowTimer wrapper throttles setInterval well below the
  // requested 250ms — empirically about 1 tick/sec. We just need to confirm
  // the loop is alive, not that it hits the requested rate (which the
  // packaged WebView on real glasses is likely to honour better).
  const ticks = await countStateLogs(3_000)
  check('render loop keeps ticking', ticks >= 2, `${ticks} state logs in 3s`)
  await screenshot('02-ticking')

  console.log('3. Tap with no song loaded — no-op, state unchanged')
  await input('click')
  // We don't expect a transition; just confirm the next tick still shows loaded=0.
  const afterTap = await waitForState(
    m => m.includes('loaded=0'),
    { label: 'state stays at loaded=0 after tap-without-song' },
  )
  check('tap with no song is a no-op', afterTap.message.includes('playing=0'), afterTap.message)
  await screenshot('03-after-tap')

  console.log('4. Swipe down with no song — no bias change (song-empty guard)')
  await input('down')
  const afterSwipe = await waitForState(
    m => m.includes('loaded=0'),
    { label: 'state stays at loaded=0 after swipe-without-song' },
  )
  // bias should still be 0 because main.ts guards swipe handling on song.lines being non-empty.
  check('swipe with no song is a no-op', afterSwipe.message.includes('bias=0'), afterSwipe.message)
  await screenshot('04-after-swipe')

  console.log('5. Ring-style double-tap with no song — no crash, still ticking')
  await input('double_click')
  // double_click without source info → onDoubleTap routes to even.exitApp()
  // which the simulator handles gracefully (no real exit). We just confirm
  // the app isn't dead — i.e. another state tick fires.
  const stillTicking = await waitForState(
    m => m.includes('[lyricsglow:state]'),
    { label: 'state still ticking after double_click', timeoutMs: 3_000 },
  ).catch(() => null)
  check('app survives double-tap (no crash)', stillTicking !== null, stillTicking?.message ?? 'no further state tick')
  await screenshot('05-after-double-tap')

  console.log()
  console.log(`Result: ${pass} passed, ${fail} failed`)
  if (fail > 0) {
    console.log('Failures:')
    for (const f of failures) console.log(`  - ${f}`)
    process.exit(1)
  }
}

main().catch(err => {
  console.error('FATAL:', err.message)
  process.exit(1)
})
