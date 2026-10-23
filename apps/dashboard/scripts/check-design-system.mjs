#!/usr/bin/env node
/**
 * Design-system guard. Fails when a file outside the catalog re-implements
 * something the catalog owns. Catalog: apps/dashboard/docs/DESIGN_SYSTEM.md.
 *
 *   node scripts/check-design-system.mjs                    check (exit 1 on violations)
 *   node scripts/check-design-system.mjs --list             print every hit, grouped by rule
 *   node scripts/check-design-system.mjs --update-baseline  rewrite the ratchet baseline
 *
 * RULES fail on any hit. RATCHET_RULES fail only when a file has more hits than
 * recorded in design-system-baseline.json, so legacy debt can shrink but not grow.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
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
    message: 'Use <Card padding="compact|default"> (or <InsetPanel> inside a card).',
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
    message: 'Pills are <Badge>; filters are <FilterChip>.',
    catalogOk: true,
  },
  {
    id: 'button-height-override',
    pattern: /<Button\b[^>]*className=["'`{][^>]*\bh-(5|6|7|8|9|10|11)\b/,
    message: 'Use size="xs|sm|md|lg|icon|iconSm".',
    catalogOk: true,
  },
  {
    id: 'panel-class',
    pattern: /(["'`\s])panel(?=["'`\s])/,
    // Prose in comments and the literal value 'panel' (a view mode) are not classes.
    skip: /^\s*(\/\/|\*|\/\*|\{\/\*)|(\?|===|\||:)\s*'panel'|'panel'\s*(:|\||\))/,
    message: 'Use <Card padding="compact|default">.',
    catalogOk: false,
  },
  {
    id: 'raw-spinner',
    pattern: /<Loader2\b|\banimate-spin\b/,
    message: 'Use <Spinner> or <LoadingBlock>.',
    catalogOk: true,
  },
  {
    id: 'hover-tint',
    pattern: /\bbg-bg-hover\/(?!50\b)\d+/,
    message: 'Hover surfaces are bg-bg-hover/50 (soft) or bg-bg-hover (selected).',
    catalogOk: false,
  },
  {
    id: 'page-tint',
    pattern: /(?<![\w-])bg-bg\/(?!50\b)\d+/,
    message: 'Use bg-bg (or bg-bg/50); a modal backdrop is .scrim.',
    catalogOk: false,
  },
  {
    id: 'muted-text-opacity',
    pattern: /(?<![\w-])text-text-muted\/\d/,
    message: 'Use text-text-muted without an opacity step.',
    catalogOk: false,
  },
  {
    id: 'legacy-class',
    pattern: /\b(badge-accent|badge-status|font-display|panel-inset)\b/,
    message: 'Removed legacy class; use Badge / InsetPanel / font-sans.',
    catalogOk: false,
  },
]

const RATCHET_RULES = [
  {
    id: 'raw-button',
    pattern: /<button\b/,
    message: 'Use <Button> (or Button asChild) from components/ui/button.',
  },
  {
    id: 'raw-input',
    pattern: /<input\b(?![^>]*type=["'](file|hidden)["'])/,
    message: 'Use <Input>, <Switch> or <SearchField> from components/ui.',
  },
  {
    id: 'hex-color',
    pattern: /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![0-9a-fA-F])/,
    skip: /^\s*(\/\/|\*)|&#|href=|['"`]#[a-z]/,
    message: 'Use color tokens (rgb(var(--color-*))) instead of hex.',
  },
  {
    id: 'arbitrary-radius',
    pattern: /\brounded(-[trblxyse]{1,2})?-\[\d/,
    message: 'Use the radius ladder: rounded-sm, md, lg, xl, 2xl, full.',
  },
  {
    id: 'border-opacity',
    pattern: /(?<![\w-])border-border\/\d/,
    message: 'Use border-border (or border-border-light for a quieter edge), not an opacity step.',
  },
]

const BASELINE_PATH = join(ROOT, 'scripts', 'design-system-baseline.json')

/** Face components whose `size={n}` must sit on the mark ladder. */
const MARK_SCALE = new Set([16, 20, 24, 32, 40, 48, 64, 80, 96, 128])
const MARK_SIZE = new RegExp(
  `<(?:UserAvatar|AiAvatar|AgentMark|ContactAvatar|TeamAvatar|PersonAvatar|AvatarStack|TeamFacepile|ParticipantMark|BotOrbAvatar)\\b[^>]*?\\bsize=\\{(\\d+)\\}`,
  'gs',
)
const MARK_SIZE_MESSAGE =
  'Avatar size must be on the mark ladder: 16, 20, 24, 32, 40, 48, 64, 80, 96, 128 (lib/mark-scale.ts).'

/** Lucide icons: size on the icon scale; stroke width comes from the base layer. */
const ICON_SCALE = new Set([14, 16, 20, 24, 32, 40])
const ICON_MESSAGE = 'Icon size is 14, 16 or 20 (24/32/40 for display); stroke comes from the base layer.'

/** Local names imported from lucide-react in this file (aliases included). */
function lucideNames(text) {
  const names = new Set()
  for (const match of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'lucide-react'/g)) {
    for (const part of match[1].split(',')) {
      const spec = part.trim().replace(/^type\s+/, '')
      if (!spec) continue
      const local = spec.includes(' as ') ? spec.split(' as ')[1].trim() : spec
      if (/^[A-Z]/.test(local) && local !== 'LucideIcon' && local !== 'LucideProps') names.add(local)
    }
  }
  return names
}

/** Opening JSX tags for `names`; braces and strings are skipped, so `=>` inside a prop is fine. */
function* jsxTags(text, names) {
  if (!names.size) return
  const open = new RegExp(`<(${[...names].join('|')})(?=[\\s/>])`, 'g')
  for (const match of text.matchAll(open)) {
    let i = match.index + match[0].length
    let depth = 0
    let quote = null
    for (; i < text.length; i++) {
      const c = text[i]
      if (quote) {
        if (c === quote && text[i - 1] !== '\\') quote = null
        continue
      }
      if (c === '"' || c === "'" || c === '`') quote = c
      else if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '>' && depth === 0) break
    }
    yield { index: match.index, tag: text.slice(match.index, i + 1) }
  }
}

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
const updateBaseline = process.argv.includes('--update-baseline')
const hits = []
/** ratchet[ruleId][file] = count */
const ratchet = Object.fromEntries(RATCHET_RULES.map((rule) => [rule.id, {}]))
for (const file of walk(SRC)) {
  const rel = relative(SRC, file)
  const relPosix = rel.split(sep).join('/')
  const inCatalog = rel.startsWith(CATALOG_DIR)
  const lines = readFileSync(file, 'utf8').split(/\r?\n/)
  lines.forEach((line, index) => {
    if (line.includes(IGNORE_MARKER)) return
    for (const rule of RULES) {
      if (inCatalog && rule.catalogOk) continue
      if (rule.skip?.test(line)) continue
      if (rule.pattern.test(line)) {
        hits.push({ rule, rel: relPosix, line: index + 1, text: line.trim() })
      }
    }
    if (inCatalog) return
    for (const rule of RATCHET_RULES) {
      if (rule.skip?.test(line)) continue
      if (rule.pattern.test(line)) {
        ratchet[rule.id][relPosix] = (ratchet[rule.id][relPosix] ?? 0) + 1
      }
    }
  })
  const text = lines.join('\n')
  MARK_SIZE.lastIndex = 0
  for (const match of text.matchAll(MARK_SIZE)) {
    const n = Number(match[1])
    if (MARK_SCALE.has(n)) continue
    const line = text.slice(0, match.index).split('\n').length
    hits.push({
      rule: { id: 'mark-scale', message: MARK_SIZE_MESSAGE },
      rel: relPosix,
      line,
      text: `size={${n}}`,
    })
  }
  for (const { index, tag } of jsxTags(text, lucideNames(text))) {
    const line = text.slice(0, index).split('\n').length
    if (lines[line - 1].includes(IGNORE_MARKER)) continue
    const size = tag.match(/\bsize=\{(\d+(?:\.\d+)?)\}/)
    const offScale = size && !ICON_SCALE.has(Number(size[1]))
    if (offScale || /\sstrokeWidth=/.test(tag)) {
      hits.push({ rule: { id: 'icon-scale', message: ICON_MESSAGE }, rel: relPosix, line, text: tag.slice(0, 140) })
    }
  }
}

if (updateBaseline) {
  const sorted = Object.fromEntries(
    Object.entries(ratchet).map(([id, files]) => [
      id,
      Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))),
    ]),
  )
  writeFileSync(BASELINE_PATH, `${JSON.stringify(sorted, null, 2)}\n`)
  const totals = Object.entries(ratchet).map(([id, files]) => `${id}=${Object.values(files).reduce((a, b) => a + b, 0)}`)
  console.log(`design-system: baseline written (${totals.join(', ')})`)
  process.exit(0)
}

let baseline = {}
try {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
} catch {
  baseline = {}
}
const grown = []
let shrunk = 0
for (const rule of RATCHET_RULES) {
  const current = ratchet[rule.id]
  const allowed = baseline[rule.id] ?? {}
  for (const [file, count] of Object.entries(current)) {
    const max = allowed[file] ?? 0
    if (count > max) grown.push({ rule, file, count, max })
  }
  for (const [file, max] of Object.entries(allowed)) {
    if ((current[file] ?? 0) < max) shrunk++
  }
}

if (grown.length) {
  for (const g of grown) {
    console.log(`[${g.rule.id}] src/${g.file}: ${g.count} (baseline ${g.max}). ${g.rule.message}`)
  }
}
if (shrunk && !grown.length) {
  console.log(`design-system: ${shrunk} file(s) below baseline; run with --update-baseline to lock in the gain.`)
}

if (hits.length === 0 && grown.length === 0) {
  console.log('design-system: ok')
  process.exit(0)
}
if (hits.length === 0) {
  console.log(`\ndesign-system: ${grown.length} ratchet regression(s)`)
  process.exit(1)
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
