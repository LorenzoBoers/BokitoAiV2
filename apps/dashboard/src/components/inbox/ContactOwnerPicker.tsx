import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { UserRound } from 'lucide-react'
import { useMembers } from '../../hooks/useMembers'
import { useTeams } from '../../hooks/useTeams'
import type { ContactOwner } from '../../lib/contacts-api'
import { ChoiceSelect } from '../ui/ChoiceSelect'
import type { ChoiceItem } from '../ui/ChoiceOption'

const NONE = '__none__'

function encode(owner: ContactOwner | null): string {
  return owner ? `${owner.kind}:${owner.id}` : NONE
}

export function decodeContactOwner(value: string): ContactOwner | null {
  if (value === NONE) return null
  const [kind, ...rest] = value.split(':')
  const id = rest.join(':')
  if ((kind === 'user' || kind === 'team') && id) return { kind, id }
  return null
}

/**
 * Account manager of a contact: a person or a team. New conversations from
 * this contact go there unless the agent may answer autonomously, and the
 * agent escalates there after the last person who handled the conversation.
 */
export default function ContactOwnerPicker({
  owner,
  onChange,
  disabled,
  triggerClassName,
  variant = 'field',
  id,
}: {
  owner: ContactOwner | null
  onChange: (owner: ContactOwner | null) => void
  disabled?: boolean
  triggerClassName?: string
  variant?: 'field' | 'chip'
  id?: string
}) {
  const { t } = useTranslation('communication')
  const { t: tn } = useTranslation('nav')
  const { members } = useMembers()
  const { teams } = useTeams()

  const groups = useMemo(() => {
    const value = encode(owner)
    const people: ChoiceItem[] = members.map((member) => ({
      value: `user:${member.uuid}`,
      label: member.name || member.email,
      kind: 'person' as const,
      person: { name: member.name, email: member.email, avatarUrl: member.avatarUrl },
    }))
    const teamItems: ChoiceItem[] = teams.map((team) => ({
      value: `team:${team.id}`,
      label: team.system ? tn(`teamPage.system.${team.kind}`) : team.name,
      kind: 'team' as const,
      team,
    }))
    const known = new Set([...people, ...teamItems].map((item) => item.value))
    // Keep an owner that is no longer listed selectable so Radix Select stays valid.
    const orphan: ChoiceItem[] =
      value !== NONE && !known.has(value)
        ? [{ value, label: t('contactPanel.ownerUnknown'), kind: owner?.kind === 'team' ? 'team' : 'person' }]
        : []
    return [
      {
        items: [
          { value: NONE, label: t('contactPanel.ownerNone'), kind: 'icon' as const, icon: UserRound },
          ...orphan,
        ],
      },
      { label: t('contactPanel.ownerPeople'), items: people },
      { label: t('contactPanel.ownerTeams'), items: teamItems },
    ]
  }, [members, teams, owner, t, tn])

  return (
    <ChoiceSelect
      id={id}
      aria-label={t('contactPanel.owner')}
      variant={variant}
      triggerClassName={triggerClassName ?? (variant === 'chip' ? undefined : 'h-8 w-full text-xs')}
      value={encode(owner)}
      onValueChange={(next) => onChange(decodeContactOwner(next))}
      disabled={disabled}
      groups={groups}
    />
  )
}
