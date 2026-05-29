#!/usr/bin/env node
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

const key = env.XANO_METADATA_API_KEY
const base = (env.XANO_META_BASE_URL || 'https://xrex-nmji-j9ur.f2.xano.io/api:meta').replace(/\/$/, '')
const v1 = path.join(root, 'xano-patches/v1')
const WORKSPACE_ID = 1
const APIGROUP_ID = 15

/** apiId optional — when set, PUT update; otherwise POST create */
const endpoints = [
  { file: 'workforce-projects-workstreams-list.xs', apiId: 303 },
  { file: 'workforce-projects-workstreams-create.xs', apiId: 299 },
  { file: 'workforce-projects-workstreams-patch.xs', apiId: 300 },
  { file: 'workforce-projects-po-agent-patch.xs', apiId: 301 },
  { file: 'workforce-projects-delete.xs', apiId: 302 },
]

async function push({ file, apiId }) {
  const xs = fs.readFileSync(path.join(v1, file), 'utf8')
  const isUpdate = apiId != null
  const url = isUpdate
    ? `${base}/workspace/${WORKSPACE_ID}/apigroup/${APIGROUP_ID}/api/${apiId}`
    : `${base}/workspace/${WORKSPACE_ID}/apigroup/${APIGROUP_ID}/api`
  const res = await fetch(url, {
    method: isUpdate ? 'PUT' : 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'text/x-xanoscript',
    },
    body: xs,
  })
  const text = await res.text()
  let parsed = text
  try {
    parsed = JSON.parse(text)
  } catch {
    // keep text
  }
  const id = typeof parsed === 'object' && parsed != null ? parsed.id : apiId
  console.log(isUpdate ? 'PUT' : 'POST', file, res.status, id ?? text.slice(0, 200))
  if (!res.ok) {
    console.error(text.slice(0, 500))
    process.exitCode = 1
    return null
  }
  return id
}

const created = []
for (const ep of endpoints) {
  const id = await push(ep)
  if (id != null) created.push({ file: ep.file, apiId: id })
}

if (created.length > 0) {
  console.log('\nRecord these API IDs in xano-patches/v1/PROJECT-HUB-BACKEND.md:')
  for (const row of created) {
    console.log(`- ${row.file}: ${row.apiId}`)
  }
}
