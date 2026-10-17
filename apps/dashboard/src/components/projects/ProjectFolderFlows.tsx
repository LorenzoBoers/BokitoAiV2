import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { ENTITY_ICONS } from '../../lib/entity-icons'
import { projectHubPath } from '../../lib/messages-paths'
import { withNavReveal } from '../../lib/nav-reveal'
import {
  getProjectBoard,
  stageLabel,
  type ProjectFlowBoard,
} from '../../lib/tickets-api'
import { workstreamPath } from '../../lib/workstream-ui'
import { timeAgo } from '../../lib/time-ago'
import { TagPill } from '../ui/TagPill'
import type { LabelColor } from '../../lib/signals-api'

const FlowIcon = ENTITY_ICONS.flow

/**
 * Flows that have a conversation in this folder (or a folder inside it).
 * Membership comes from those threads, not from an explicit flow-to-folder link.
 */
export function ProjectFolderFlows({ projectId }: { projectId: string }) {
  const { t } = useTranslation('nav')
  const [boards, setBoards] = useState<ProjectFlowBoard[] | null>(null)

  const load = useCallback(async () => {
    try {
      const rows = await getProjectBoard(projectId)
      setBoards(rows.filter((row) => row.tickets.length > 0))
    } catch {
      setBoards([])
    }
  }, [projectId])

  useEffect(() => {
    setBoards(null)
    void load()
  }, [load])

  if (!boards || boards.length === 0) return null

  return (
    <section className="space-y-2" aria-labelledby="project-flows" data-testid="project-folder-flows">
      <h2 id="project-flows" className="text-sm font-semibold text-text-heading">
        {t('projects.detail.flows', { defaultValue: 'Flows' })}
      </h2>
      <div className="space-y-3">
        {boards.map((board) => {
          const tag = board.tags[0]
          return (
            <div key={board.workstream_id} className="rounded-lg border border-border/60">
              <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
                <FlowIcon size={14} className="shrink-0 text-text-muted" aria-hidden />
                <Link
                  to={workstreamPath(board.workstream_id)}
                  className="min-w-0 truncate text-sm font-medium text-text-heading hover:underline"
                >
                  {board.name}
                </Link>
                {tag ? (
                  <TagPill
                    names={tag.name}
                    tone="action"
                    size="sm"
                    color={(tag.color || '') as LabelColor}
                    icon={tag.icon}
                  />
                ) : null}
              </div>
              <ul className="divide-y divide-border/40">
                {board.tickets.map((ticket) => {
                  const stage = board.stages.find((row) => row.key === ticket.stage_key)
                  const queue = ticket.status === 'closed' || ticket.status === 'done' ? 'closed' : 'open'
                  return (
                    <li key={ticket.signal_id}>
                      <Link
                        to={withNavReveal(projectHubPath(projectId, queue, ticket.signal_id))}
                        className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-bg-hover/70"
                      >
                        <span className="min-w-0 flex-1 truncate text-text-primary">
                          {ticket.subject || t('projects.detail.noSubject')}
                        </span>
                        {stage ? (
                          <span className="shrink-0 text-xs text-text-muted">{stageLabel(stage, t)}</span>
                        ) : null}
                        {ticket.last_message_at ? (
                          <span className="shrink-0 text-2xs tabular-nums text-text-muted">
                            {timeAgo(ticket.last_message_at, t)}
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>
    </section>
  )
}
