import { stripHash } from './hashtag'

/** Flow page / list title: always `#hashtag` from the first action tag when present. */
export function flowTitle(ws: {
  name: string
  tags?: Array<{ name: string }> | null
}): string {
  const raw = ws.tags?.[0]?.name || ws.name || ''
  return stripHash(raw)
}

export function flowTitleWithHash(ws: {
  name: string
  tags?: Array<{ name: string }> | null
}): string {
  const name = flowTitle(ws)
  return name ? `#${name}` : ''
}
