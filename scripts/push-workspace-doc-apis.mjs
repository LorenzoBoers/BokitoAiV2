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

const endpoints = [
  { file: 'workforce-workspace-doc-get.xs', apigroup: 15, apiId: 289 },
  { file: 'workforce-workspace-doc-pages-create.xs', apigroup: 15, apiId: 279 },
  { file: 'workforce-workspace-doc-page-blocks-get.xs', apigroup: 15, apiId: 280 },
  { file: 'workforce-workspace-doc-page-blocks-batch.xs', apigroup: 15, apiId: 290 },
  { file: 'integrations-workspace-doc-worker-reindex-page.xs', apigroup: 17, apiId: 283 },
  { file: 'integrations-workspace-doc-worker-tree.xs', apigroup: 17, apiId: 284 },
  { file: 'integrations-workspace-doc-worker-blocks.xs', apigroup: 17, apiId: 291 },
]

async function push({ file, apigroup, apiId }) {
  const xs = fs.readFileSync(path.join(v1, file), 'utf8')
  const url = `${base}/workspace/1/apigroup/${apigroup}/api/${apiId}`
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'text/x-xanoscript',
    },
    body: xs,
  })
  const text = await res.text()
  console.log('PUT', file, res.status, text.slice(0, 120))
  if (!res.ok) process.exitCode = 1
}

for (const ep of endpoints) {
  await push(ep)
}
