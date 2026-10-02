/**
 * Composer slash verbs — typed commands that resolve to the same services
 * the thread buttons call. Plain language still goes through Bokito.
 *
 * Implemented: /assign, /signal, /approve, /manual, /assisted, /autonomous
 */

import type { AiHandlingMode } from './ai-handling'

export type ComposerVerb = 'assign' | 'signal' | 'approve' | AiHandlingMode

export type ParsedComposerVerb = {
  verb: ComposerVerb
  /** Remainder after the verb token (trimmed). */
  arg: string
  /** Full original body without leading slash command (for clearing). */
  rest: string
}

const VERBS: ComposerVerb[] = ['assign', 'signal', 'approve', 'manual', 'assisted', 'autonomous']

const VERB_SET = new Set<string>(VERBS)

/** Dutch aliases for the AI handling verbs. */
const ALIASES: Record<string, ComposerVerb> = {
  handmatig: 'manual',
  geassisteerd: 'assisted',
  autonoom: 'autonomous',
}

/** True when the verb sets AI handling on the conversation. */
export function isAiHandlingVerb(verb: ComposerVerb): verb is AiHandlingMode {
  return verb === 'manual' || verb === 'assisted' || verb === 'autonomous'
}

/**
 * Parse a leading slash verb from composer body text.
 * Returns null when the body is not a verb command.
 */
export function parseComposerVerb(body: string): ParsedComposerVerb | null {
  const trimmed = body.trimStart()
  if (!trimmed.startsWith('/')) return null
  const match = /^\/([a-zA-Z]+)(?:\s+(.*))?$/s.exec(trimmed)
  if (!match) return null
  const raw = match[1].toLowerCase()
  const token = ALIASES[raw] ?? raw
  if (!VERB_SET.has(token)) return null
  const arg = (match[2] ?? '').trim()
  return {
    verb: token as ComposerVerb,
    arg,
    rest: arg,
  }
}

export function composerVerbHelp(locale: 'en' | 'nl' = 'en'): string {
  if (locale === 'nl') {
    return 'Commando’s: /assign <naam>, /signal <type>, /approve, /handmatig, /geassisteerd, /autonoom'
  }
  return 'Commands: /assign <name>, /signal <type>, /approve, /manual, /assisted, /autonomous'
}
