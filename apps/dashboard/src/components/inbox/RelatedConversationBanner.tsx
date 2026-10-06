import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
import type { RelatedConversation } from '../../lib/inbox-api'
import { inboxPath } from '../../lib/messages-paths'
import { timeAgo } from '../../lib/time-ago'
import { ChannelGlyph, channelKind } from '../ui/ChannelGlyph'

const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/**
 * The related conversation worth showing above the composer: the newest one
 * with activity in the last week. Older history stays in the contact panel.
 */
export function pickRelatedConversation(
  rows: RelatedConversation[] | undefined,
  now = Date.now(),
): RelatedConversation | null {
  if (!rows || rows.length === 0) return null
  const recent = rows
    .filter((row) => {
      if (!row.lastMessageAt) return false
      const at = new Date(row.lastMessageAt).getTime()
      return Number.isFinite(at) && now - at <= RECENT_WINDOW_MS
    })
    .sort((a, b) => new Date(b.lastMessageAt ?? 0).getTime() - new Date(a.lastMessageAt ?? 0).getTime())
  return recent[0] ?? null
}

type Props = {
  rows: RelatedConversation[] | undefined
  /** Name of the person, for the sentence. */
  contactName?: string | null
}

/**
 * "The customer also wrote 2 hours ago via WhatsApp" above the composer, so
 * nobody answers an email that was already settled in another channel.
 */
export default function RelatedConversationBanner({ rows, contactName }: Props) {
  const { t } = useTranslation('communication')
  const related = pickRelatedConversation(rows)
  if (!related) return null
  const kind = channelKind(related.channel)
  const channelLabel = t(`composer.channel.${kind}`, { defaultValue: related.channel })
  const name = (contactName || '').trim() || t('relatedConversation.customer')
  const when = related.lastMessageAt ? timeAgo(related.lastMessageAt, t) : ''
  const sentence =
    related.lastMessageDirection === 'outbound'
      ? t('relatedConversation.weReplied', { channel: channelLabel, when })
      : t('relatedConversation.customerWrote', { name, channel: channelLabel, when })
  return (
    <div
      className="mx-auto mb-1.5 flex w-full max-w-3xl items-center gap-2 rounded-md border border-border/50 bg-bg-elevated/70 px-2.5 py-1.5 text-xs text-text-secondary"
      data-testid="related-conversation-banner"
    >
      <ChannelGlyph channel={related.channel} size={13} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate-fade">
        {sentence}
        {related.hasOpenProposal ? ` ${t('relatedConversation.openProposalThere')}` : ''}
      </span>
      <Link
        to={inboxPath('open', related.id)}
        className="inline-flex shrink-0 items-center gap-0.5 font-medium text-accent hover:underline"
      >
        {t('relatedConversation.open')}
        <ArrowUpRight size={12} aria-hidden />
      </Link>
    </div>
  )
}
