import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Sparkles } from 'lucide-react'
import { Card } from '../ui/card'
import { ChoiceSelect } from '../ui/ChoiceSelect'
import { DefaultBadge } from '../ui/DefaultBadge'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { useAuth } from '../../context/AuthContext'
import { bokitoUpdateAgent } from '../../lib/bokito-api'
import { getTeamOverview, type TeamOverview } from '../../lib/teams-api'
import type { AskTarget } from '../../lib/workforce-api'

const AUTO = 'auto'

function encode(target: AskTarget | undefined): string {
  if (!target || target.kind === 'auto' || !target.id) return AUTO
  return `${target.kind}:${target.id}`
}

/**
 * Who this agent asks when it needs a person: Automatic (owner, then whoever
 * handed it the work, then the owner team) or one fixed person or team.
 */
export function AgentAskTargetCard({
  agentId,
  askTarget,
  canEdit,
  onChanged,
}: {
  agentId: string
  askTarget: AskTarget | undefined
  canEdit: boolean
  onChanged?: () => void
}) {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const [overview, setOverview] = useState<TeamOverview | null>(null)
  const [value, setValue] = useState(encode(askTarget))

  useEffect(() => setValue(encode(askTarget)), [askTarget])
  useEffect(() => {
    if (!token) return
    getTeamOverview(token)
      .then(setOverview)
      .catch(() => setOverview(null))
  }, [token])

  const change = async (next: string) => {
    if (!token) return
    const previous = value
    setValue(next)
    const [kind, id] = next === AUTO ? ['auto', null] : next.split(':', 2)
    try {
      await bokitoUpdateAgent(token, agentId, {
        ask_target: { kind: kind as AskTarget['kind'], id },
      })
      onChanged?.()
    } catch (err) {
      setValue(previous)
      toast.error(formatApiErrorMessage(err, t('workforce.agents.askTargetError')))
    }
  }

  const teams = (overview?.teams ?? []).filter((team) => team.kind !== 'agents')
  const people = overview?.people ?? []

  return (
    <Card className="px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-text-heading">
            {t('workforce.agents.askTargetTitle')}
          </h3>
          <p className="mt-1 text-sm text-text-muted">{t('workforce.agents.askTargetHint')}</p>
        </div>
        <ChoiceSelect
          aria-label={t('workforce.agents.askTargetTitle')}
          triggerClassName="h-8 w-[220px] text-xs"
          value={value}
          onValueChange={(next) => void change(next)}
          disabled={!canEdit}
          groups={[
            {
              items: [
                {
                  value: AUTO,
                  label: t('workforce.agents.askTargetAuto'),
                  kind: 'icon',
                  icon: Sparkles,
                  trailing: <DefaultBadge>{t('channelsPage.defaultBadge')}</DefaultBadge>,
                },
              ],
            },
            {
              items: teams.map((team) => {
                const label = team.kind === 'people' ? t('teamPage.system.people') : team.name
                return {
                  value: `team:${team.id}`,
                  label,
                  kind: 'team' as const,
                  team: { ...team, name: label },
                }
              }),
            },
            {
              items: people.map((person) => ({
                value: `user:${person.uuid}`,
                label: person.name || person.email,
                kind: 'person' as const,
                person: {
                  name: person.name || person.email,
                  email: person.email,
                  avatarUrl: person.avatar_url,
                },
              })),
            },
          ]}
        />
      </div>
    </Card>
  )
}
