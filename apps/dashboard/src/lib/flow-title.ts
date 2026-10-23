import { stripHash } from './hashtag'

/** Operator-facing flow title (independent of the action-tag label). */
export function flowTitle(ws: {
  name: string
  tags?: Array<{ name: string }> | null
}): string {
  const fromName = stripHash(ws.name || '')
  if (fromName) return fromName
  return stripHash(ws.tags?.[0]?.name || '')
}

/** Action-tag hashtag for the flow, or empty when unbound. */
export function flowActionTag(ws: {
  tags?: Array<{ name: string }> | null
}): string {
  return stripHash(ws.tags?.[0]?.name || '')
}

export function flowTitleWithHash(ws: {
  name: string
  tags?: Array<{ name: string }> | null
}): string {
  const tag = flowActionTag(ws)
  if (tag) return tag
  return flowTitle(ws)
}
