import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowUpRight } from 'lucide-react'
import { AutonomousProposalCard } from '../inbox/AutonomousProposalCard'
import { useNavBadges } from '../../context/NavBadgeContext'
import type { MessageRow } from '../../lib/messages-api'

function projectIdFromMessage(msg: MessageRow): string | null {
  if (typeof msg.project_id === 'string' && msg.project_id) return msg.project_id
  const fromPayload = msg.payload?.project_id
  return typeof fromPayload === 'string' ? fromPayload : null
}

type Props = {
  messages: MessageRow[]
  onRefresh: () => void | Promise<void>
  /** Show project name + link to project communication above each card. */
  showProjectContext?: boolean
  projectNameById?: Map<string, string>
}

export function WorkforceDecisionList({
  messages,
  onRefresh,
  showProjectContext = false,
  projectNameById,
}: Props) {
  const { t } = useTranslation('nav')
  const { refresh: refreshBadges } = useNavBadges()
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set())

  const handleResolved = useCallback(
    async (messageId: string) => {
      setResolvedIds((prev) => new Set(prev).add(messageId))
      await onRefresh()
      await refreshBadges()
    },
    [onRefresh, refreshBadges],
  )

  const visible = messages.filter((m) => !resolvedIds.has(m.id))
  if (!visible.length) {
    return <p className="text-sm text-text-muted">{t('projectHub.communication.empty')}</p>
  }

  return (
    <ul className="space-y-4">
      {visible.map((msg) => {
        const projectId = projectIdFromMessage(msg)
        const projectName =
          projectId && projectNameById ? projectNameById.get(projectId) : null
        const projectHref = projectId ? `/project/${projectId}/communication` : null
        return (
          <li key={msg.id} className="space-y-2">
            {showProjectContext && (projectName || projectHref) ? (
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-muted">
                <span>
                  {projectName ?? t('project.communication.title')}
                  {msg.created_at ? (
                    <span className="ml-2 text-text-muted/80">
                      {new Date(msg.created_at).toLocaleString()}
                    </span>
                  ) : null}
                </span>
                {projectHref ? (
                  <Link
                    to={projectHref}
                    className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
                  >
                    {t('project.communication.hubLink')}
                    <ArrowUpRight size={12} />
                  </Link>
                ) : null}
              </div>
            ) : msg.created_at ? (
              <p className="text-xs text-text-muted">
                {new Date(msg.created_at).toLocaleString()}
                {msg.message_type ? (
                  <span className="ml-2 capitalize">{msg.message_type.replace(/_/g, ' ')}</span>
                ) : null}
              </p>
            ) : null}
            <AutonomousProposalCard
              message={msg}
              onResolved={() => void handleResolved(msg.id)}
            />
          </li>
        )
      })}
    </ul>
  )
}
