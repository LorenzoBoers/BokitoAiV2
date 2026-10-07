#!/usr/bin/env node
/**
 * Design-system guard. Fails when a file outside the catalog re-implements
 * something the catalog owns. Catalog: apps/dashboard/docs/DESIGN_SYSTEM.md.
 *
 *   node scripts/check-design-system.mjs          check (exit 1 on violations)
 *   node scripts/check-design-system.mjs --list   print every hit, grouped by rule
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SRC = join(ROOT, 'src')
const CATALOG_DIR = `components${sep}ui${sep}`

/** Rules: `pattern` runs per line; `catalogOk` skips components/ui. */
const RULES = [
  {
    id: 'window-confirm',
    pattern: /\bwindow\.confirm\(/,
    message: 'Use `const confirm = useConfirm()` and `await confirm({...})` (ConfirmDialog).',
    catalogOk: true,
  },
  {
    id: 'native-select',
    pattern: /<select(\s|>|$)/,
    message: 'Use <Select> from components/ui/select.',
    catalogOk: true,
  },
  {
    id: 'arbitrary-text-size',
    pattern: /\btext-\[\d+(\.\d+)?(px|rem)\]/,
    message: 'Use the size ladder: text-2xs, xs, sm, base, lg, xl, 2xl.',
    catalogOk: false,
  },
  {
    id: 'hand-rolled-card',
    pattern: /["'`][^"'`]*\brounded-(lg|xl)\b[^"'`]*\bborder-border[^"'`]*\bbg-bg-surface(?![\w/-])[^"'`]*["'`]|["'`][^"'`]*\bbg-bg-surface(?![\w/-])[^"'`]*\bborder-border[^"'`]*\brounded-(lg|xl)\b[^"'`]*["'`]/,
    // Floating layers, chat bubbles and inputs share the surface fill legitimately.
    skip: /\b(shadow-overlay|shadow-sm|rounded-t[lr]-|fixed|absolute|placeholder:|resize|Dialog\.Content)\b/,
    message: 'Use <Card> / className="panel" (or <InsetPanel> inside a card).',
    catalogOk: true,
  },
  {
    id: 'legacy-inset',
    pattern: /\bbg-bg-elevated\/40\b/,
    message: 'Use <InsetPanel> or OptionCard instead of bg-bg-elevated/40.',
    catalogOk: true,
  },
  {
    id: 'raw-status-color',
    pattern: /\b(bg|text|border|ring|from|to)-(emerald|amber|red|green|yellow|rose|orange|lime)-\d{2,3}\b/,
    message: 'Use status tokens (status-success/warning/error/info) or <Badge>/<Callout>.',
    catalogOk: false,
  },
  {
    id: 'capsule-chip',
    pattern: /["'`][^"'`]*\brounded-full\b[^"'`]*\bpx-[1-4](\.5)?\b[^"'`]*\btext-(2xs|xs)\b[^"'`]*["'`]|["'`][^"'`]*\btext-(2xs|xs)\b[^"'`]*\bpx-[1-4](\.5)?\b[^"'`]*\brounded-full\b[^"'`]*["'`]/,
    // Numeric count bubbles stay round.
    skip: /\b(min-w-\S+|count-pop|tabular-nums)\b/,
    message: 'Pills are <Badge> (rounded-lg); filters are <FilterChip>.',
    catalogOk: true,
  },
  {
    id: 'legacy-class',
    pattern: /\b(badge-accent|badge-status|font-display|panel-inset)\b/,
    message: 'Removed legacy class; use Badge / InsetPanel / font-sans.',
    catalogOk: false,
  },
]

/** Lines carrying this marker are exempt (use sparingly, with a reason). */
const IGNORE_MARKER = 'design-system-ignore'

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else if (/\.(tsx|ts)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full)
  }
  return out
}

const list = process.argv.includes('--list')
const hits = []
for (const file of walk(SRC)) {
  const rel = relative(SRC, file)
  const inCatalog = rel.startsWith(CATALOG_DIR)
  const lines = readFileSync(file, 'utf8').split(/\r?\n/)
  lines.forEach((line, index) => {
    if (line.includes(IGNORE_MARKER)) return
    for (const rule of RULES) {
      if (inCatalog && rule.catalogOk) continue
      if (rule.skip?.test(line)) continue
      if (rule.pattern.test(line)) {
        hits.push({ rule, rel: rel.split(sep).join('/'), line: index + 1, text: line.trim() })
      }
    }
  })
}

if (hits.length === 0) {
  console.log('design-system: ok')
  process.exit(0)
}

const byRule = new Map()
for (const hit of hits) {
  const bucket = byRule.get(hit.rule.id) ?? []
  bucket.push(hit)
  byRule.set(hit.rule.id, bucket)
}
for (const [id, bucket] of byRule) {
  console.log(`\n[${id}] ${bucket[0].rule.message} (${bucket.length})`)
  for (const hit of list ? bucket : bucket.slice(0, 8)) {
    console.log(`  src/${hit.rel}:${hit.line}  ${hit.text.slice(0, 140)}`)
  }
  if (!list && bucket.length > 8) console.log(`  ... ${bucket.length - 8} more (run with --list)`)
}
console.log(`\ndesign-system: ${hits.length} violation(s)`)
process.exit(1)
