#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const envPath = path.join(root, '.env')
const env = Object.fromEntries(
  fs
    .readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i), l.slice(i + 1)]
    }),
)

const [, , apiId, xsRel] = process.argv
if (!apiId || !xsRel) {
  console.error('Usage: node scripts/push-xano-api.mjs <api_id> <xanoscript-path>')
  process.exit(1)
}

const key = env.XANO_METADATA_API_KEY
const base = (env.XANO_META_BASE_URL || 'https://xrex-nmji-j9ur.f2.xano.io/api:meta').replace(/\/$/, '')
const xs = fs.readFileSync(path.join(root, xsRel), 'utf8')
const url = `${base}/workspace/1/apigroup/17/api/${apiId}`

const res = await fetch(url, {
  method: 'PUT',
  headers: {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'text/x-xanoscript',
  },
  body: xs,
})
const text = await res.text()
console.log(res.status, text.slice(0, 500))
if (!res.ok) process.exit(1)
