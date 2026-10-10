import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useAuth } from '../../context/AuthContext'
import { useIsAdmin } from '../../hooks/useIsAdmin'
import { updateChannelDefaultTeam } from '../../lib/channel-accounts-api'
import { listTeams, type Team } from '../../lib/teams-api'
import { ChoiceSelect } from '../ui/ChoiceSelect'
import { DefaultBadge } from '../ui/DefaultBadge'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'

const PEOPLE = '__people__'

/** Team that owns new conversations on this channel. All people by default. */
export default function ChannelTeamPicker({
  accountId,
  teamId,
  onChanged,
}: {
  accountId: string
  teamId: string | null
  onChanged?: () => void
}) {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const isAdmin = useIsAdmin()
  const [teams, setTeams] = useState<Team[]>([])
  const [value, setValue] = useState(teamId)
  const [busy, setBusy] = useState(false)

  useEffect(() => setValue(teamId), [teamId])
  useEffect(() => {
    if (!token) return
    listTeams(token)
      .then(setTeams)
      .catch(() => setTeams([]))
  }, [token])

  const peopleTeam = teams.find((tm) => tm.kind === 'people')
  const custom = teams.filter((tm) => !tm.system)
  const current = !value || value === peopleTeam?.id ? PEOPLE : value
  // Radix Select breaks when the controlled value has no SelectItem — keep orphans listed.
  const knownIds = new Set(custom.map((team) => team.id))
  const orphanTeam =
    current !== PEOPLE && !knownIds.has(current)
      ? teams.find((team) => team.id === current) ?? null
      : null
  const orphanId = current !== PEOPLE && !knownIds.has(current) && !orphanTeam ? current : null

  const change = async (next: string) => {
    if (!token || busy) return
    const previous = value
    const id = next === PEOPLE ? null : next
    setValue(id)
    setBusy(true)
    try {
      await updateChannelDefaultTeam(token, accountId, id)
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
      triggerClassName="h-8 w-[200px] text-xs"
      value={current}
      onValueChange={(next) => void change(next)}
      disabled={!isAdmin || busy || !accountId || !token}
      groups={[
        {
          items: [
            {
              value: PEOPLE,
              label: t('teamPage.system.people'),
              kind: 'team',
              team: peopleTeam ?? { name: t('teamPage.system.people') },
              trailing: <DefaultBadge>{t('channelsPage.defaultBadge')}</DefaultBadge>,
            },
            ...(orphanTeam
              ? [{ value: orphanTeam.id, label: orphanTeam.name, kind: 'team' as const, team: orphanTeam }]
              : []),
            ...(orphanId
              ? [
                  {
                    value: orphanId,
                    label: t('channelsPage.unknownTeam'),
                    kind: 'team' as const,
                    team: { name: t('channelsPage.unknownTeam') },
                  },
                ]
              : []),
            ...custom.map((team) => ({
              value: team.id,
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
