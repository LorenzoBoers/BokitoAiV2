/**
 * Minimal head management for the public docs pages (no helmet dependency).
 * Sets document.title plus description/og meta tags, and restores the
 * previous title on cleanup so in-app navigation is unaffected.
 */

export interface DocsMeta {
  title: string
  description?: string
}

function upsertMeta(attr: 'name' | 'property', key: string, content: string): void {
  let tag = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
  if (!tag) {
    tag = document.createElement('meta')
    tag.setAttribute(attr, key)
    document.head.appendChild(tag)
  }
  tag.setAttribute('content', content)
}

/** Apply docs SEO meta. Returns a cleanup restoring the previous title. */
export function applyDocsMeta(meta: DocsMeta): () => void {
  const previousTitle = document.title
  document.title = meta.title
  upsertMeta('property', 'og:title', meta.title)
  if (meta.description) {
    upsertMeta('name', 'description', meta.description)
    upsertMeta('property', 'og:description', meta.description)
  }
  upsertMeta('property', 'og:type', 'article')
  return () => {
    document.title = previousTitle
  }
}
