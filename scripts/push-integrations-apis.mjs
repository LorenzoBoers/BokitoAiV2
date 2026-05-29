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
const APIGROUP_ID = 17

/** apiId optional — when set, PUT update; otherwise POST create */
const endpoints = [
  { file: 'integrations-providers-list.xs', apiId: 307 },
  { file: 'integrations-connections-list.xs', apiId: 308 },
  { file: 'integrations-mcp-tenant-bindings.xs', apiId: 309 },
  { file: 'integrations-github-connections-list.xs', apiId: 310 },
  { file: 'integrations-github-connection-get.xs', apiId: 311 },
  { file: 'integrations-github-connection-delete.xs', apiId: 312 },
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
  console.log(isUpdate ? 'PUT' : 'POST', file, res.status, text.slice(0, 120))
  if (!res.ok) process.exitCode = 1
}

for (const ep of endpoints) {
  await push(ep)
}
