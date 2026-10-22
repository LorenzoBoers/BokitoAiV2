#!/usr/bin/env node
/**
 * Build the dashboard and write the hashed index stylesheet to a stable path.
 *
 *   node scripts/css-snapshot.mjs <output.css>
 *
 * The content hash stays out of the destination name so two builds can be diffed.
 * Not part of CI. Used to prove a token change did not move the shipped CSS.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const outArg = process.argv[2]
if (!outArg) {
  console.error('usage: node scripts/css-snapshot.mjs <output.css>')
  process.exit(1)
}

const dashboardRoot = fileURLToPath(new URL('..', import.meta.url))
const build = spawnSync('npx', ['vite', 'build'], {
  cwd: dashboardRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: process.env,
})
if (build.status !== 0) process.exit(build.status ?? 1)

const assetsDir = path.join(dashboardRoot, 'dist', 'assets')
const cssFiles = readdirSync(assetsDir)
  .filter((name) => /^index-.+\.css$/.test(name))
  .sort()
if (cssFiles.length !== 1) {
  console.error(
    `expected one index-*.css in ${assetsDir}, found ${cssFiles.length}: ${cssFiles.join(', ')}`,
  )
  process.exit(1)
}

const out = path.resolve(outArg)
mkdirSync(path.dirname(out), { recursive: true })
writeFileSync(out, readFileSync(path.join(assetsDir, cssFiles[0])))
console.log(`wrote ${out} from ${cssFiles[0]}`)
