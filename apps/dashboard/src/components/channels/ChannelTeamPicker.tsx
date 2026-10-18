import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useAuth } from '../../context/AuthContext'
import { useIsAdmin } from '../../hooks/useIsAdmin'
import { useMembers } from '../../hooks/useMembers'
import { updateChannelDefaultOwner } from '../../lib/channel-accounts-api'
import { listTeams, type Team } from '../../lib/teams-api'
import { ChoiceSelect } from '../ui/ChoiceSelect'
import { DefaultBadge } from '../ui/DefaultBadge'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'

const PEOPLE = '__people__'
const personValue = (id: string) => `user:${id}`
const teamValue = (id: string) => `team:${id}`

/** Who owns new conversations on this channel when a person must take over. */
export default function ChannelTeamPicker({
  accountId,
  teamId,
  userId,
  onChanged,
}: {
  accountId: string
  teamId: string | null
  userId?: string | null
  onChanged?: () => void
}) {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const isAdmin = useIsAdmin()
  const { members } = useMembers()
  const [teams, setTeams] = useState<Team[]>([])
  const [value, setValue] = useState<{ kind: 'all' | 'user' | 'team'; id: string | null }>({
    kind: userId ? 'user' : teamId ? 'team' : 'all',
    id: userId || teamId || null,
  })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setValue({
      kind: userId ? 'user' : teamId ? 'team' : 'all',
      id: userId || teamId || null,
    })
  }, [teamId, userId])

  useEffect(() => {
    if (!token) return
    listTeams(token)
      .then(setTeams)
      .catch(() => setTeams([]))
  }, [token])

  const allTeam = teams.find((tm) => tm.system)
  const custom = teams.filter((tm) => !tm.system)
  const current =
    value.kind === 'user' && value.id
      ? personValue(value.id)
      : value.kind === 'team' && value.id && value.id !== allTeam?.id
        ? teamValue(value.id)
        : PEOPLE

  const knownPeople = useMemo(() => new Set(members.map((m) => m.uuid)), [members])
  const knownTeams = useMemo(() => new Set(custom.map((team) => team.id)), [custom])
  const orphanPerson =
    value.kind === 'user' && value.id && !knownPeople.has(value.id)
      ? { id: value.id, name: t('channelsPage.unknownPerson') }
      : null
  const orphanTeam =
    value.kind === 'team' && value.id && !knownTeams.has(value.id)
      ? teams.find((team) => team.id === value.id) ?? {
          id: value.id,
          name: t('channelsPage.unknownTeam'),
        }
      : null

  const change = async (next: string) => {
    if (!token || busy) return
    const previous = value
    let owner: { kind: 'all' | 'user' | 'team'; id: string | null }
    if (next === PEOPLE) {
      owner = { kind: 'all', id: null }
    } else if (next.startsWith('user:')) {
      owner = { kind: 'user', id: next.slice(5) }
    } else if (next.startsWith('team:')) {
      owner = { kind: 'team', id: next.slice(5) }
    } else {
      return
    }
    setValue(owner)
    setBusy(true)
    try {
      await updateChannelDefaultOwner(token, accountId, {
        userId: owner.kind === 'user' ? owner.id : null,
        teamId: owner.kind === 'team' ? owner.id : null,
      })
      onChanged?.()
    } catch (err) {
      setValue(previous)
      toast.error(formatApiErrorMessage(err, t('teamPage.saveError')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ChoiceSelect
      aria-label={t('channelsPage.team')}
      triggerClassName="h-8 w-full min-w-0 text-xs"
      value={current}
      onValueChange={(next) => void change(next)}
      disabled={!isAdmin || busy || !accountId || !token}
      groups={[
        {
          items: [
            {
              value: PEOPLE,
              label: t('teamPage.system.all'),
              kind: 'team',
              team: allTeam ?? { name: t('teamPage.system.all') },
              trailing: <DefaultBadge>{t('channelsPage.defaultBadge')}</DefaultBadge>,
            },
          ],
        },
        {
          label: t('channelsPage.ownerPeople'),
          items: [
            ...(orphanPerson
              ? [
                  {
                    value: personValue(orphanPerson.id),
                    label: orphanPerson.name,
                    kind: 'person' as const,
                    person: { name: orphanPerson.name },
                  },
                ]
              : []),
            ...members.map((member) => ({
              value: personValue(member.uuid),
              label: member.name || member.email,
              kind: 'person' as const,
              person: {
                name: member.name || member.email,
                email: member.email,
                avatarUrl: member.avatarUrl,
              },
            })),
          ],
        },
        {
          label: t('channelsPage.ownerTeams'),
          items: [
            ...(orphanTeam
              ? [
                  {
                    value: teamValue(orphanTeam.id),
                    label: orphanTeam.name || t('channelsPage.unknownTeam'),
                    kind: 'team' as const,
                    team: orphanTeam,
                  },
                ]
              : []),
            ...custom.map((team) => ({
              value: teamValue(team.id),
              label: team.name,
              kind: 'team' as const,
              team,
            })),
          ],
        },
      ]}
    />
  )
}
