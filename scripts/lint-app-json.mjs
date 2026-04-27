#!/usr/bin/env node
// Pre-pack lint for app.json. Catches the class of bug where a
// placeholder host or stale version slips into a packaged .ehpk,
// and warns when the network whitelist diverges from URLs the source
// actually fetches (gap or stale entries).
//
// Designed to be small, fast, and shared across all four glasses
// repos with no per-repo customization.
//
// Run:
//   node scripts/lint-app-json.mjs
// Or via npm script:
//   "prepack": "node scripts/lint-app-json.mjs"

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'

const PATH = 'app.json'
const PLACEHOLDER_PATTERNS = [
  /your-/i,
  /\bexample\.com\b/i,
  /\bplaceholder\b/i,
  /\bTODO\b/,
  /\bREPLACE\b/i,
]

let appJson
try {
  appJson = JSON.parse(readFileSync(PATH, 'utf-8'))
} catch (err) {
  console.error(`✗ ${PATH}: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}

const errors = []
const warns = []

// Required fields
for (const k of ['package_id', 'edition', 'name', 'version', 'min_app_version', 'min_sdk_version', 'entrypoint', 'permissions', 'supported_languages']) {
  if (!(k in appJson)) errors.push(`missing required field: ${k}`)
}

// package_id sanity
if (appJson.package_id && !/^[a-z][a-z0-9]*\.[a-z][a-z0-9]*\.[a-z][a-z0-9]+/.test(appJson.package_id)) {
  errors.push(`package_id "${appJson.package_id}" doesn't match required reverse-domain (lowercase, no hyphens) — see Even Hub spec`)
}

// version is x.y.z
if (appJson.version && !/^\d+\.\d+\.\d+$/.test(appJson.version)) {
  errors.push(`version "${appJson.version}" must be x.y.z`)
}

// permissions: array of objects with name + desc; network has whitelist
if (appJson.permissions !== undefined) {
  if (!Array.isArray(appJson.permissions)) {
    errors.push('permissions must be an array (NOT a key-value map)')
  } else {
    appJson.permissions.forEach((p, i) => {
      if (typeof p !== 'object' || p === null) {
        errors.push(`permissions[${i}] is not an object`)
        return
      }
      if (!p.name) errors.push(`permissions[${i}] missing name`)
      if (!p.desc) errors.push(`permissions[${i}] missing desc`)
      if (p.name === 'network') {
        if (!Array.isArray(p.whitelist)) {
          errors.push(`network permission requires a whitelist array`)
        } else {
          p.whitelist.forEach((url, j) => {
            for (const pat of PLACEHOLDER_PATTERNS) {
              if (pat.test(url)) {
                errors.push(`whitelist[${j}] looks like a placeholder: "${url}". Replace with the real deployed host before packing.`)
                break
              }
            }
            if (!/^[a-z]+:\/\//i.test(url)) {
              warns.push(`whitelist[${j}] "${url}" has no scheme — Even Hub may reject it. Add https:// or wss://`)
            }
          })
        }
      }
    })
  }
}

// supported_languages must be allowlist of BCP-47 codes
const VALID_LANGS = new Set(['en', 'de', 'fr', 'es', 'it', 'zh', 'ja', 'ko'])
if (Array.isArray(appJson.supported_languages)) {
  appJson.supported_languages.forEach(l => {
    if (!VALID_LANGS.has(l)) errors.push(`supported_languages: "${l}" not in allowlist`)
  })
}

// ─── Whitelist gap / stale-entry detection (warnings only) ───────────
//
// Walks src/ recursively, extracts URL literals from .ts files, normalizes
// to scheme://host, then cross-references against the network whitelist.
// Reports two flavors of drift:
//   GAP   — code references a URL whose host isn't whitelisted
//   STALE — whitelist contains a host the code never references
//
// These are warnings, not errors. URL extraction is heuristic (regex on
// source) so false positives are possible — comments, test fixtures,
// dynamic template strings won't always parse cleanly. Worker-template
// URLs run on Cloudflare and aren't subject to app.json — explicitly
// excluded by skipping the worker-template/ tree.
function walkSource(dir, files = []) {
  if (!existsSync(dir)) return files
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.') || name === 'node_modules' || name === 'dist') continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walkSource(full, files)
    else {
      const ext = extname(full)
      if (ext === '.ts' || ext === '.tsx' || ext === '.mjs' || ext === '.js') files.push(full)
    }
  }
  return files
}

function normalizeHost(raw) {
  try {
    const u = new URL(raw)
    return `${u.protocol}//${u.host}`
  } catch {
    return null
  }
}

// Match scheme + host. Require at least one `.` OR a port — filters out
// fragments like `ws://football` that are usually template-literal slices.
const URL_RE = /(?:https?|wss?):\/\/(?:[a-z0-9\-]+\.)+[a-z0-9\-]+(?::\d+)?|(?:https?|wss?):\/\/[a-z0-9\-]+:\d+/gi

// Heuristics for "this URL is data, not a fetch target":
//   placeholder="..."  / aria-placeholder="..."  — input UI hints
//   href="..."         — anchor links to docs / external help
//   url: '...'         — object-literal data (e.g. sources arrays)
//   target="..."       — anchor metadata adjacent to href
// A URL on such a line is treated as data and excluded from the
// fetch-host audit. A maintainer who wants a URL re-included can add
// `// lint-app-json:check` on the same line.
const DATA_LINE_PATTERNS = [
  /\bplaceholder\s*=/i,
  /\baria-placeholder\s*=/i,
  /\bhref\s*=/i,
  /\bsrc\s*=/i,
  /\bcite\s*=/i,
  /\burl\s*:\s*['"`]/, // object-literal: { url: '...' }
  /\bicon\s*:\s*['"`]/, // common pattern in data lists
]
const FORCE_CHECK_RE = /lint-app-json\s*:\s*check/i

function extractUrlsFromFile(path) {
  const out = new Set()
  const text = readFileSync(path, 'utf-8')
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue
    const isDataLine = DATA_LINE_PATTERNS.some(p => p.test(line)) && !FORCE_CHECK_RE.test(line)
    if (isDataLine) continue
    const matches = line.match(URL_RE)
    if (!matches) continue
    for (const m of matches) {
      const norm = normalizeHost(m)
      if (norm) out.add(norm)
    }
  }
  return out
}

const networkPerm = Array.isArray(appJson.permissions)
  ? appJson.permissions.find(p => p?.name === 'network')
  : null
if (networkPerm?.whitelist) {
  const whitelistHosts = new Set()
  for (const url of networkPerm.whitelist) {
    const norm = normalizeHost(url)
    if (norm) whitelistHosts.add(norm)
  }

  const codeHosts = new Set()
  for (const file of walkSource('src')) {
    for (const u of extractUrlsFromFile(file)) {
      // Skip localhost / loopback — dev only, not subject to whitelist.
      if (u.includes('localhost') || u.includes('127.0.0.1')) continue
      // Skip URLs that look like placeholders themselves — these are
      // typically <input placeholder="..."> hints in settings UIs, not
      // real fetch targets.
      if (PLACEHOLDER_PATTERNS.some(p => p.test(u))) continue
      codeHosts.add(u)
    }
  }

  // GAP: code references a host that isn't covered by any whitelist entry.
  // Allow a prefix-match — `https://example.com` covers any path on that host.
  for (const codeHost of codeHosts) {
    if (!whitelistHosts.has(codeHost)) {
      // Try scheme-tolerant match (https-vs-wss on same host).
      const codeHostNoScheme = codeHost.replace(/^[a-z]+:\/\//i, '')
      const covered = [...whitelistHosts].some(w =>
        w.replace(/^[a-z]+:\/\//i, '') === codeHostNoScheme,
      )
      if (!covered) {
        warns.push(`whitelist GAP: src/ references ${codeHost} but no matching entry. Packaged build will silently fail to fetch this host.`)
      }
    }
  }

  // STALE: whitelist entry whose host the code never references. Cosmetic.
  // Allow scheme-tolerant match the same way.
  for (const wHost of whitelistHosts) {
    const wNoScheme = wHost.replace(/^[a-z]+:\/\//i, '')
    const referenced = [...codeHosts].some(c =>
      c.replace(/^[a-z]+:\/\//i, '') === wNoScheme,
    )
    if (!referenced) {
      // Soft-skip: hosts pasted by the user via phone settings (Cue, Glance
      // worker URLs) won't appear as literals in src/. We can't tell the
      // difference statically, so flag and let the maintainer decide.
      warns.push(`whitelist STALE? "${wHost}" is in app.json but no literal match in src/. (May still be reached via runtime-configured URL — verify.)`)
    }
  }
}

if (errors.length > 0) {
  console.error(`✗ ${PATH} has ${errors.length} error${errors.length > 1 ? 's' : ''}:`)
  for (const e of errors) console.error(`  - ${e}`)
  if (warns.length > 0) {
    console.error(`Warnings:`)
    for (const w of warns) console.error(`  - ${w}`)
  }
  process.exit(1)
}

if (warns.length > 0) {
  console.warn(`⚠ ${PATH} warnings:`)
  for (const w of warns) console.warn(`  - ${w}`)
}

console.log(`✓ ${PATH} OK (${appJson.package_id} v${appJson.version})`)
