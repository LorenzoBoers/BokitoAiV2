import { isPlaceholderContactAddress } from './contact-label'
import { newConversationPath } from './messages-paths'

/** Deep-links that open compose / create flows from other product surfaces. */

export type ComposeIntent = {
  to?: string
  subject?: string
  body?: string
  connectionId?: string | number
}

export function parseComposeIntent(params: URLSearchParams): ComposeIntent | null {
  if (params.get('compose') !== '1') return null
  const to = params.get('to')?.trim() || undefined
  const subject = params.get('subject')?.trim() || undefined
  const body = params.get('body')?.trim() || undefined
  const connectionRaw = params.get('connectionId')?.trim()
  const connectionId = connectionRaw || undefined
  return { to, subject, body, connectionId }
}

export function stripComposeIntent(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params)
  next.delete('compose')
  next.delete('to')
  next.delete('subject')
  next.delete('body')
  next.delete('connectionId')
  return next
}

/** Opens the Communication draft surface for outbound email (create-on-send). */
export function composeEmailPath(intent: ComposeIntent = {}): string {
  return newConversationPath({
    intent: 'contact',
    to: intent.to,
    subject: intent.subject,
    body: intent.body,
    connectionId: intent.connectionId,
  })
}

export function newContactPath(address?: string): string {
  const params = new URLSearchParams({ new: '1' })
  const value = address?.trim()
  if (value) params.set('address', value)
  return `/contacts?${params}`
}

export function newAgentPath(): string {
  return '/agents?new=1'
}

/** Email compose only when the address looks like mail, not a phone/Slack id. */
export function canComposeToAddress(channel: string | undefined, address: string | undefined): boolean {
  const value = address?.trim() ?? ''
  if (!value.includes('@')) return false
  if (isPlaceholderContactAddress(value)) return false
  if (channel && channel !== 'email' && channel !== 'widget') return false
  return true
}
