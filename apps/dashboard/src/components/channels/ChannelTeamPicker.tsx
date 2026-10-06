import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useAuth } from '../../context/AuthContext'
import { useIsAdmin } from '../../hooks/useIsAdmin'
import { updateChannelDefaultTeam } from '../../lib/channel-accounts-api'
import { listTeams, type Team } from '../../lib/teams-api'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
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
    <Select
      value={current}
      onValueChange={(v) => void change(v)}
      disabled={!isAdmin || busy || !accountId || !token}
    >
      <SelectTrigger className="h-8 w-[200px] text-xs" aria-label={t('channelsPage.team')}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={PEOPLE}>
          <span className="flex items-center gap-2">
            {t('teamPage.system.people')}
            <DefaultBadge>{t('channelsPage.defaultBadge')}</DefaultBadge>
          </span>
        </SelectItem>
        {orphanTeam ? <SelectItem value={orphanTeam.id}>{orphanTeam.name}</SelectItem> : null}
        {orphanId ? <SelectItem value={orphanId}>{t('channelsPage.unknownTeam')}</SelectItem> : null}
        {custom.map((team) => (
          <SelectItem key={team.id} value={team.id}>
            {team.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
