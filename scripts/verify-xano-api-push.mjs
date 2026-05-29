#!/usr/bin/env node
/**
 * Post-push verification for Xano API scripts pushed via the Metadata API.
 *
 * Usage:
 *   node scripts/verify-xano-api-push.mjs --apigroup 15 --api 302
 *   node scripts/verify-xano-api-push.mjs --apigroup 15 --api 302 303 290
 *
 * Exits 1 when forbidden patterns are found in live xanoscript.
 */
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(root, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i), l.slice(i + 1)]
    }),
)

const WORKSPACE_ID = 1

const FORBIDDEN = [
  {
    id: 'backtick-get-name',
    pattern: /`\(\$\w+\|get:"name"\)/,
    message: 'Literal backtick string around |get:"name" — name comparison will always fail.',
  },
  {
    id: 'empty-db-query',
    pattern: /db\.query\s+""/,
    message: 'Empty table name in db.query (Metadata API corruption).',
  },
  {
    id: 'empty-db-del',
    pattern: /db\.del\s+""/,
    message: 'Empty table name in db.del (Metadata API corruption).',
  },
  {
    id: 'var-doc',
    pattern: /\bas \$doc\b|\$doc\./,
    message: 'Variable $doc — Xano coerces doc to integer 1.',
  },
  {
    id: 'var-project-dot',
    pattern: /\$project\./,
    message: 'Variable $project.* — mis-resolves in project-hub scripts.',
  },
  {
    id: 'blocks-list-return',
    pattern: /db\.query workspace_doc_blocks[\s\S]{0,200}return\s*=\s*\{type:\s*"list"\}/,
    message: 'workspace_doc_blocks query with return {type: "list"} only — collides with type column.',
  },
]

function parseArgs(argv) {
  let apigroup = null
  const apiIds = []
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--apigroup' && argv[i + 1]) {
      apigroup = Number(argv[++i])
    } else if (argv[i] === '--api' && argv[i + 1]) {
      while (argv[i + 1] && !argv[i + 1].startsWith('--')) {
        apiIds.push(Number(argv[++i]))
      }
    }
  }
  if (!apigroup || apiIds.length === 0) {
    console.error('Usage: node scripts/verify-xano-api-push.mjs --apigroup <id> --api <id> [id...]')
    process.exit(1)
  }
  return { apigroup, apiIds }
}

async function fetchApiScript(apigroup, apiId) {
  const key = env.XANO_METADATA_API_KEY
  const base = (env.XANO_META_BASE_URL || 'https://xrex-nmji-j9ur.f2.xano.io/api:meta').replace(/\/$/, '')
  const url = `${base}/workspace/${WORKSPACE_ID}/apigroup/${apigroup}/api/${apiId}?include_xanoscript=true`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } })
  if (!res.ok) {
    throw new Error(`GET API ${apiId} failed: ${res.status} ${(await res.text()).slice(0, 200)}`)
  }
  const data = await res.json()
  const script = data?.xanoscript?.value ?? data?.xanoscript ?? ''
  return { name: data?.name ?? `api-${apiId}`, script: typeof script === 'string' ? script : script?.value ?? '' }
}

async function main() {
  const { apigroup, apiIds } = parseArgs(process.argv)
  let failed = false

  for (const apiId of apiIds) {
    const { name, script } = await fetchApiScript(apigroup, apiId)
    console.log(`\nAPI ${apiId} (${name})`)
    if (!script) {
      console.error('  WARN: no xanoscript returned')
      failed = true
      continue
    }
    let apiFailed = false
    for (const rule of FORBIDDEN) {
      if (rule.pattern.test(script)) {
        console.error(`  FAIL [${rule.id}]: ${rule.message}`)
        apiFailed = true
        failed = true
      }
    }
    if (!apiFailed) {
      console.log('  OK: no forbidden patterns')
    }
  }

  if (failed) process.exit(1)
  console.log('\nAll checked APIs passed verification.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
