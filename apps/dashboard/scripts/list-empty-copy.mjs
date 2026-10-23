#!/usr/bin/env node
/**
 * Empty-state copy that renders outside <EmptyState>.
 *
 * 1. Every NL locale key whose value starts with "Nog geen" or "Geen ".
 * 2. Every use of that key in src (`t('key')`, `t("ns:key")`, template literal).
 * 3. A use is loose when no `<EmptyState` sits on that line or the 10 above.
 * 4. Prints loose uses per file. `countLooseEmptyCopy()` feeds the
 *    `loose-empty-copy` ratchet in check-design-system.mjs.
 *
 * Lines with `design-system-ignore` are exempt (a real field value such as
 * "Nog geen labels" in a form row).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src')
const NL = join(SRC, 'locales', 'nl')
const WINDOW = 10
const EMPTY_PREFIX = /^(Nog geen|Geen )/
const PLURAL = /_(zero|one|two|few|many|other)$/

function flatten(obj, prefix, out) {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object') flatten(value, path, out)
    else if (typeof value === 'string' && EMPTY_PREFIX.test(value)) out.add(path.replace(PLURAL, ''))
  }
  return out
}

export function emptyCopyKeys() {
  const keys = new Set()
  for (const name of readdirSync(NL)) {
    if (!name.endsWith('.json')) continue
    flatten(JSON.parse(readFileSync(join(NL, name), 'utf8')), '', keys)
  }
  return keys
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name !== 'locales') walk(full, out)
    } else if (/\.(tsx|ts)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full)
  }
  return out
}

function escape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** `{ 'pages/Foo.tsx': [{ line, key }] }` for every loose use. */
export function looseEmptyCopy() {
  const keys = [...emptyCopyKeys()].sort((a, b) => b.length - a.length)
  if (!keys.length) return {}
  const use = new RegExp(`['"\`](?:[\\w-]+:)?(${keys.map(escape).join('|')})(?:_(?:zero|one|two|few|many|other))?['"\`]`, 'g')
  const out = {}
  for (const file of walk(SRC)) {
    const rel = relative(SRC, file).split(sep).join('/')
    const lines = readFileSync(file, 'utf8').split(/\r?\n/)
    lines.forEach((line, index) => {
      if (line.includes('design-system-ignore')) return
      use.lastIndex = 0
      for (const match of line.matchAll(use)) {
        const above = lines.slice(Math.max(0, index - WINDOW), index + 1)
        if (above.some((l) => l.includes('<EmptyState'))) continue
        ;(out[rel] ??= []).push({ line: index + 1, key: match[1] })
      }
    })
  }
  return out
}

export function countLooseEmptyCopy() {
  return Object.fromEntries(Object.entries(looseEmptyCopy()).map(([file, uses]) => [file, uses.length]))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const loose = looseEmptyCopy()
  const files = Object.entries(loose).sort((a, b) => b[1].length - a[1].length)
  const verbose = process.argv.includes('--list')
  let total = 0
  for (const [file, uses] of files) {
    total += uses.length
    console.log(`${String(uses.length).padStart(3)}  src/${file}`)
    if (verbose) for (const u of uses) console.log(`       :${u.line}  ${u.key}`)
  }
  console.log(`\n${emptyCopyKeys().size} empty-copy keys, ${total} loose use(s) in ${files.length} file(s).`)
}
