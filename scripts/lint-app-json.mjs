#!/usr/bin/env node
// Pre-pack lint for app.json. Catches the class of bug where a
// placeholder host or stale version slips into a packaged .ehpk.
// Designed to be small, fast, and shared across all four glasses
// repos with no per-repo customization.
//
// Run:
//   node scripts/lint-app-json.mjs
// Or via npm script:
//   "prepack": "node scripts/lint-app-json.mjs"

import { readFileSync } from 'node:fs'

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
