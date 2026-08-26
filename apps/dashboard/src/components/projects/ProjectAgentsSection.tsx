import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Loader2, Star, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import {
  addProjectAgent,
  listProjectAgents,
  removeProjectAgent,
  setProjectAgentDefault,
  type ProjectAgentRow,
} from '../../lib/projects-api'

/**
 * Project agent roster: which agents work on this project, and which one
 * handles project threads by default (falls back to the project lead, then
 * the tenant lead agent).
 */
export function ProjectAgentsSection({
  projectId,
  agents,
}: {
  projectId: string
  agents: Array<{ id: string; name: string }>
}) {
  const { t } = useTranslation('nav')
  const [roster, setRoster] = useState<ProjectAgentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    try {
      setRoster(await listProjectAgents(projectId))
    } catch {
      setRoster([])
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  const available = useMemo(() => {
    const taken = new Set(roster.map((row) => row.agent_id))
    return agents.filter((agent) => !taken.has(agent.id))
  }, [agents, roster])

  const add = async (agentId: string) => {
    setAdding(true)
    try {
      await addProjectAgent(projectId, agentId, roster.length === 0)
      await load()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('projects.detail.agentAddError')))
    } finally {
      setAdding(false)
    }
  }

  const makeDefault = async (agentId: string) => {
    setBusyId(agentId)
    try {
      await setProjectAgentDefault(projectId, agentId, true)
      await load()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('projects.detail.agentDefaultError')))
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (agentId: string) => {
    setBusyId(agentId)
    try {
      await removeProjectAgent(projectId, agentId)
      await load()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('projects.detail.agentRemoveError')))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-text-muted">{t('projects.detail.agentsLabel')}</Label>
      {loading ? (
        <p className="text-sm text-text-muted">{t('projects.detail.agentsLoading')}</p>
      ) : roster.length === 0 ? (
        <p className="text-sm text-text-muted">{t('projects.detail.agentsEmpty')}</p>
      ) : (
        <ul className="space-y-1">
          {roster.map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between gap-2 rounded-md border border-border/50 px-2.5 py-1.5"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Link
                  to={`/agents/${row.agent_id}`}
                  className="truncate text-sm text-text-primary hover:text-accent hover:underline"
                >
                  {row.name}
                </Link>
                {row.is_default ? (
                  <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                    {t('projects.detail.agentDefaultBadge')}
                  </Badge>
                ) : null}
              </span>
              <span className="flex shrink-0 items-center gap-1">
                {!row.is_default ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 px-1.5"
                    disabled={busyId !== null}
                    title={t('projects.detail.agentMakeDefault')}
                    onClick={() => void makeDefault(row.agent_id)}
                  >
                    {busyId === row.agent_id ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Star size={12} />
                    )}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1.5 text-text-muted hover:text-status-error"
                  disabled={busyId !== null}
                  title={t('projects.detail.agentRemove')}
                  onClick={() => void remove(row.agent_id)}
                >
                  {busyId === row.agent_id ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <X size={12} />
                  )}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {available.length > 0 ? (
        <Select disabled={adding} value="" onValueChange={(value) => void add(value)}>
          <SelectTrigger className="h-8 text-sm">
            <SelectValue placeholder={t('projects.detail.agentAddPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {available.map((agent) => (
              <SelectItem key={agent.id} value={agent.id}>
                {agent.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
    </div>
  )
}

export default ProjectAgentsSection
