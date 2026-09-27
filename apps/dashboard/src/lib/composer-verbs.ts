/**
 * Composer slash verbs — typed commands that resolve to the same services
 * the thread buttons call. Plain language still goes through Bokito.
 *
 * Implemented: /assign, /signal, /approve
 */

export type ComposerVerb = 'assign' | 'signal' | 'approve'

export type ParsedComposerVerb = {
  verb: ComposerVerb
  /** Remainder after the verb token (trimmed). */
  arg: string
  /** Full original body without leading slash command (for clearing). */
  rest: string
}

const VERBS: ComposerVerb[] = ['assign', 'signal', 'approve']

const VERB_SET = new Set<string>(VERBS)

/**
 * Parse a leading slash verb from composer body text.
 * Returns null when the body is not a verb command.
 */
export function parseComposerVerb(body: string): ParsedComposerVerb | null {
  const trimmed = body.trimStart()
  if (!trimmed.startsWith('/')) return null
  const match = /^\/([a-zA-Z]+)(?:\s+(.*))?$/s.exec(trimmed)
  if (!match) return null
  const token = match[1].toLowerCase()
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
    return 'Commando’s: /assign <naam>, /signal <type>, /approve'
  }
  return 'Commands: /assign <name>, /signal <type>, /approve'
}
