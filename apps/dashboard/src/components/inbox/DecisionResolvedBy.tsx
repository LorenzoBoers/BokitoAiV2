import { useTranslation } from 'react-i18next'
import type { InboxMember } from '../../lib/inbox-api'
import { Avatar } from '../ui/avatar'
import { cn } from '../../lib/utils'

/** Who settled a decision — shown on the cloud, not as a chat bubble. */
export function DecisionResolvedBy({
  status,
  name,
  member,
  className,
}: {
  status: 'approved' | 'rejected' | 'mixed' | string
  name: string | null | undefined
  member?: InboxMember | null
  className?: string
}) {
  const { t } = useTranslation('communication')
  const display = (name || member?.name || '').trim()
  if (!display) return null
  const label =
    status === 'approved'
      ? t('proposal.status.approvedBy', { name: display })
      : status === 'rejected'
        ? t('proposal.status.rejectedBy', { name: display })
        : t('actionBundle.resolvedBy', { name: display })
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 text-2xs text-text-muted', className)}
      data-testid="decision-resolved-by"
    >
      <Avatar
        kind="person"
        name={display}
        email={member?.email || display}
        imageUrl={member?.avatarUrl ?? null}
        size={16}
        decorative
      />
      <span>{label}</span>
    </span>
  )
}

export function memberForUuid(
  membersById: Record<number, InboxMember> | undefined,
  userUuid: string | null | undefined,
): InboxMember | null {
  if (!userUuid || !membersById) return null
  return Object.values(membersById).find((m) => m.uuid === userUuid) ?? null
}
