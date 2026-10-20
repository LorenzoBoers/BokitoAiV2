#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))
const uiSrc = join(repoRoot, 'packages', 'ui', 'src')
const dashboardSrc = join(repoRoot, 'apps', 'dashboard', 'src')
const failures = []

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) walk(path, out)
    else if (/\.(tsx?|mjs|js)$/.test(entry)) out.push(path)
  }
  return out
}

const forbidden = [
  { id: 'react-dom', pattern: /from ['"]react-dom['"]/ },
  { id: 'expo', pattern: /from ['"]expo/ },
  { id: 'apps', pattern: /from ['"][^'"]*apps\// },
  { id: 'fetch', pattern: /\bfetch\s*\(/ },
  { id: 'hex', pattern: /#[0-9a-fA-F]{3,8}\b/ },
]

for (const file of walk(uiSrc)) {
  const text = readFileSync(file, 'utf8')
  for (const rule of forbidden) {
    if (rule.pattern.test(text)) {
      failures.push(`${relative(repoRoot, file)}: ${rule.id}`)
    }
  }
}

const islandOk = /[\\/]src[\\/]islands[\\/]/
for (const file of walk(dashboardSrc)) {
  if (islandOk.test(file)) continue
  const text = readFileSync(file, 'utf8')
  if (/from ['"]react-native['"]/.test(text)) {
    failures.push(`${relative(repoRoot, file)}: react-native import outside islands`)
  }
}

if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log('ui boundaries ok')
