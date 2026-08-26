/** Same-origin product-help screenshots only. No remote or relative escapes. */

export const DOCS_ASSET_SRC =
  /^\/api\/docs\/assets\/[a-z0-9](?:[a-z0-9._/-]*[a-z0-9])?\.(png|webp)$/i

export function isDocsAssetSrc(href: string): boolean {
  if (!href || href.includes('..') || href.includes('\\')) return false
  return DOCS_ASSET_SRC.test(href)
}

const IMAGE_LINE = /^!\[([^\]]*)\]\(([^)]+)\)$/
const ITALIC_CAPTION = /^\*(.+)\*$|^_(.+)_$/

export function parseImageLine(line: string): { alt: string; src: string } | null {
  const match = line.trim().match(IMAGE_LINE)
  if (!match) return null
  return { alt: match[1], src: match[2] }
}

export function parseItalicCaption(line: string | undefined): string | null {
  if (!line) return null
  const match = line.trim().match(ITALIC_CAPTION)
  return match ? (match[1] ?? match[2]) : null
}
