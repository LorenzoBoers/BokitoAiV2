/**
 * Copy guard for the operator glossary (docs/product-help/glossary.yaml).
 *
 * Fails when:
 * - nl and en locale JSON trees have different keys
 * - a forbidden synonym appears in locale values, product-help or mobile copy
 * - a Dutch locale value contains a whole word from nl_forbidden_words
 *
 * Paths, code identifiers and glossary.yaml itself are not scanned.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../../..')
const locales = path.join(repo, 'apps/dashboard/src/locales')
const help = path.join(repo, 'docs/product-help')
const mobileCopy = path.join(repo, 'apps/mobile/src/lib/copy.ts')

function parseGlossary(text) {
  const forbidden = []
  const nlWords = []
  const badOutcomes = []
  let inForbidden = false
  let inNlWords = false
  let inBad = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('nl_forbidden_words:')) {
      inNlWords = true
      inForbidden = false
      continue
    }
    if (line.startsWith('bad_outcomes:')) {
      inBad = true
      inNlWords = false
      inForbidden = false
      continue
    }
    if (line.startsWith('loanwords:')) {
      inNlWords = false
      inForbidden = false
      inBad = false
      continue
    }
    if (inBad && line.startsWith('- ')) {
      const m = line.match(/"([^"]+)"/)
      if (m) badOutcomes.push(m[1])
      continue
    }
    if (line.startsWith('forbidden:')) {
      inForbidden = true
      inNlWords = false
      const inline = line.slice('forbidden:'.length).trim()
      if (inline.startsWith('[')) {
        for (const m of inline.matchAll(/"([^"]+)"/g)) forbidden.push(m[1])
        inForbidden = false
      }
      continue
    }
    if (inForbidden && line.startsWith('- ')) {
      const m = line.match(/"([^"]+)"/)
      if (m) forbidden.push(m[1])
      continue
    }
    if (inNlWords && line.startsWith('- ')) {
      nlWords.push(line.slice(2).trim())
      continue
    }
    if (line && !line.startsWith('-') && !line.startsWith('#')) {
      inForbidden = false
    }
  }
  return {
    forbidden: [...new Set(forbidden.filter(Boolean))],
    nlWords: [...new Set(nlWords.filter(Boolean))],
    badOutcomes: [...new Set(badOutcomes.filter(Boolean))],
  }
}

function walkKeys(value, prefix, out) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of Object.keys(value).sort()) {
      walkKeys(value[key], prefix ? `${prefix}.${key}` : key, out)
    }
    return
  }
  out.add(prefix)
}

function collectStrings(value, prefix, out) {
  if (typeof value === 'string') {
    out.push([prefix, value])
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => collectStrings(item, `${prefix}[${i}]`, out))
    return
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      collectStrings(value[key], prefix ? `${prefix}.${key}` : key, out)
    }
  }
}

function filesUnder(dir, ext) {
  if (!fs.existsSync(dir)) return []
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...filesUnder(full, ext))
    else if (entry.name.endsWith(ext)) out.push(full)
  }
  return out
}

const glossary = parseGlossary(fs.readFileSync(path.join(help, 'glossary.yaml'), 'utf8'))
const errors = []

const nlDir = path.join(locales, 'nl')
const enDir = path.join(locales, 'en')
for (const name of fs.readdirSync(nlDir)) {
  if (!name.endsWith('.json')) continue
  const nl = JSON.parse(fs.readFileSync(path.join(nlDir, name), 'utf8'))
  const enPath = path.join(enDir, name)
  if (!fs.existsSync(enPath)) {
    errors.push(`missing en locale ${name}`)
    continue
  }
  const en = JSON.parse(fs.readFileSync(enPath, 'utf8'))
  const nlKeys = new Set()
  const enKeys = new Set()
  walkKeys(nl, '', nlKeys)
  walkKeys(en, '', enKeys)
  for (const key of nlKeys) if (!enKeys.has(key)) errors.push(`en/${name} missing ${key}`)
  for (const key of enKeys) if (!nlKeys.has(key)) errors.push(`nl/${name} missing ${key}`)
}

const needles = glossary.forbidden.map((term) => ({
  term,
  re: new RegExp(`(?<![\\w])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w])`, 'i'),
}))
const nlWordRes = glossary.nlWords.map((word) => ({
  word,
  re: new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`),
}))

function scanText(rel, text, { dutch }) {
  const visible = text
    .replace(/\]\([^)]+\)/g, ']')
    .replace(/\/docs\/[a-z0-9/_-]+/gi, '')
    .replace(/`[^`\n]*`/g, '')
  text = visible
  for (const phrase of glossary.badOutcomes) {
    if (text.includes(phrase)) errors.push(`${rel}: bad outcome "${phrase}"`)
  }
  for (const { term, re } of needles) {
    if (re.test(text)) errors.push(`${rel}: forbidden "${term}"`)
  }
  if (dutch) {
    for (const { word, re } of nlWordRes) {
      if (re.test(text)) errors.push(`${rel}: Dutch copy contains "${word}"`)
    }
  }
}

for (const lang of ['nl', 'en']) {
  for (const file of filesUnder(path.join(locales, lang), '.json')) {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    const strings = []
    collectStrings(data, '', strings)
    const rel = path.relative(repo, file)
    for (const [key, value] of strings) {
      scanText(`${rel}:${key}`, value, { dutch: lang === 'nl' })
    }
  }
}

for (const file of filesUnder(help, '.md')) {
  const rel = path.relative(repo, file)
  const dutch = rel.includes(`${path.sep}nl${path.sep}`) || rel.includes('/nl/')
  scanText(rel, fs.readFileSync(file, 'utf8'), { dutch })
}

if (fs.existsSync(mobileCopy)) {
  const source = fs.readFileSync(mobileCopy, 'utf8')
  const [enBlock, nlBlock] = source.split('const nl: CopyTree')
  const keysOf = (block) =>
    new Set([...block.matchAll(/'([a-zA-Z0-9_.]+\.[a-zA-Z0-9_.]+)'\s*:/g)].map((m) => m[1]))
  const enKeys = keysOf(enBlock || '')
  const nlKeys = keysOf(nlBlock || '')
  for (const key of enKeys) if (!nlKeys.has(key)) errors.push(`mobile nl missing ${key}`)
  for (const key of nlKeys) if (!enKeys.has(key)) errors.push(`mobile en missing ${key}`)
  const literals = [...source.matchAll(/'([^'\\]*(?:\\.[^'\\]*)*)'|"([^"\\]*(?:\\.[^"\\]*)*)"/g)]
  literals.forEach((m, i) => {
    scanText(`apps/mobile/src/lib/copy.ts#${i}`, m[1] ?? m[2] ?? '', { dutch: true })
  })
}

const allowPath = path.join(here, 'copy-tsx-allowlist.txt')
const allow = new Set(
  fs.existsSync(allowPath)
    ? fs.readFileSync(allowPath, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    : [],
)
const tsxRoot = path.join(repo, 'apps/dashboard/src')
const hardcoded = /(?:title|aria-label|placeholder)="[A-Za-z][^"]{2,}"|(?<![=-])>\s*[A-Za-z][^<{}();=:]{2,}\s*</
for (const file of filesUnder(tsxRoot, '.tsx')) {
  const rel = path.relative(repo, file).replaceAll('\\', '/')
  if (allow.has(rel)) continue
  const text = fs.readFileSync(file, 'utf8')
  const hit = text.match(hardcoded)
  if (hit) errors.push(`${rel}: hardcoded UI string ${JSON.stringify(hit[0].trim().slice(0, 60))} (move it to i18n)`)
}

if (errors.length) {
  const shown = errors.slice(0, 80)
  console.error(`check-copy: ${errors.length} problem(s)`)
  for (const line of shown) console.error(`  ${line}`)
  if (errors.length > shown.length) console.error(`  … ${errors.length - shown.length} more`)
  process.exit(1)
}
console.log('check-copy: ok')
