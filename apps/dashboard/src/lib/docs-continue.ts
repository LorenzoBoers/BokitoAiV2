export const LEARN_LAST_KEY = 'bokito.learn.lastSlug'
export const DOCS_LAST_KEY = 'bokito.docs.lastPath'

export type ContinueRead = {
  path: string
  title: string
}

function readJson(key: string): ContinueRead | null {
  try {
    const raw = globalThis.localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ContinueRead>
    if (typeof parsed.path === 'string' && parsed.path && typeof parsed.title === 'string') {
      return { path: parsed.path, title: parsed.title }
    }
    return null
  } catch {
    return null
  }
}

function writeJson(key: string, value: ContinueRead): void {
  try {
    globalThis.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private mode or quota — continue-reading is optional.
  }
}

export function readLastLearn(): ContinueRead | null {
  return readJson(LEARN_LAST_KEY)
}

export function writeLastLearn(slug: string, title: string): void {
  const next = slug.trim()
  if (!next) return
  writeJson(LEARN_LAST_KEY, { path: `/learn/${next}`, title: title.trim() || next })
}

export function readLastDocs(): ContinueRead | null {
  return readJson(DOCS_LAST_KEY)
}

export function writeLastDocs(path: string, title: string): void {
  const next = path.trim()
  if (!next) return
  writeJson(DOCS_LAST_KEY, { path: next, title: title.trim() || next })
}
