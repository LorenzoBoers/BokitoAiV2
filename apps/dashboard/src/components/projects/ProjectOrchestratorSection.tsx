import { useMemo, useState } from 'react'
import { agentStatusOf, presenceLabel, presenceTextClass } from '../../lib/presence'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Pencil, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../ui/button'
import { AiAvatar } from '../ui/AiAvatar'
import { AgentOptionRow, type AgentVisualFields } from '../ui/AgentOptionRow'
import { ChoiceOption } from '../ui/ChoiceOption'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { AgentActiveLine } from '../inbox/IdentitySeenLine'
import { toAiAvatarProps } from '../../lib/agent-avatar'
import { openEntityPath } from '../../lib/open-entity'
import { useAgentLive, withAgentLive } from '../../hooks/useAgentPresence'
import { cn } from '../../lib/utils'
import type { AgentSummary, RuntimeAgent } from '../../lib/workforce-api'
import {
  createProjectPoAgent,
  linkProjectPoAgentById,
  type ProjectRow,
} from '../../lib/projects-api'

const CREATE_LEAD = '__create__'

function isAssignableAgent(agent: Pick<RuntimeAgent, 'kind' | 'is_active'>): boolean {
  if (agent.kind === 'personal') return false
  return agent.is_active !== false
}

function leadFromProject(project: ProjectRow): AgentVisualFields | null {
  const agent = project.po_agent
  if (!agent) return null
  return {
    id: agent.id,
    name: agent.name,
    avatar_kind: agent.avatar_kind,
    avatar_icon: agent.avatar_icon,
    avatar_color: agent.avatar_color,
    avatar_image_url: agent.avatar_image_url,
  }
}

function useProjectLeadOptions(project: ProjectRow, agents: RuntimeAgent[]) {
  const live = agents.find((agent) => agent.id === project.po_agent_id) ?? null
  const options = useMemo(() => {
    const seen = new Set<string>()
    const list: RuntimeAgent[] = []
    for (const agent of agents) {
      if (!isAssignableAgent(agent) || seen.has(agent.id)) continue
      seen.add(agent.id)
      list.push(agent)
    }
    if (live && !seen.has(live.id)) list.unshift(live)
    return list
  }, [agents, live])
  return { live, options }
}

function useLinkProjectLead(project: ProjectRow, onChanged: () => Promise<void>) {
  const { t } = useTranslation('nav')
  const [linking, setLinking] = useState(false)

  const linkLead = async (agentId: string) => {
    if (agentId === project.po_agent_id) return
    setLinking(true)
    try {
      if (agentId === CREATE_LEAD) {
        await createProjectPoAgent(project.id, t('projects.detail.leadDefaultName'))
      } else {
        await linkProjectPoAgentById(project.id, agentId)
      }
      toast.success(t('projects.detail.leadLinked'))
      await onChanged()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('projects.detail.leadLinkError')))
    } finally {
      setLinking(false)
    }
  }

  return { linking, linkLead }
}

/** Header pencil: assign another company agent as the project default. */
export function ProjectAgentEditButton({
  project,
  agents,
  onChanged,
}: {
  project: ProjectRow
  agents: RuntimeAgent[]
  onChanged: () => Promise<void>
}) {
  const { t } = useTranslation('nav')
  const { options } = useProjectLeadOptions(project, agents)
  const { linking, linkLead } = useLinkProjectLead(project, onChanged)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="iconSm"
          disabled={linking}
          aria-label={t('projects.detail.changeLead')}
          title={t('projects.detail.changeLead')}
        >
          <Pencil size={14} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-72 w-64 overflow-y-auto">
        <DropdownMenuLabel>{t('projects.detail.changeLead')}</DropdownMenuLabel>
        {options.length === 0 ? (
          <DropdownMenuItem disabled>{t('projects.detail.leadPlaceholder')}</DropdownMenuItem>
        ) : (
          options.map((agent) => (
            <DropdownMenuItem
              key={agent.id}
              disabled={linking}
              onSelect={() => void linkLead(agent.id)}
            >
              <AgentOptionRow agent={agent} size={18} />
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={linking} onSelect={() => void linkLead(CREATE_LEAD)}>
          <ChoiceOption
            item={{ value: CREATE_LEAD, label: t('projects.detail.leadCreate'), kind: 'icon', icon: Plus }}
            size={18}
          />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Compact project agent identity. Click opens the agent; the header pencil
 * assigns a different default.
 */
export function ProjectOrchestratorSection({
  project,
  agents,
}: {
  project: ProjectRow
  agents: RuntimeAgent[]
}) {
  const { t } = useTranslation('nav')
  const lead = leadFromProject(project)
  const { live: rosterAgent } = useProjectLeadOptions(project, agents)
  const liveWork = useAgentLive(lead?.id ?? null)
  const base: AgentSummary | null = rosterAgent ?? project.po_agent ?? null
  const statusSource = base ? withAgentLive(base) : null
  const workState = statusSource ? agentStatusOf(statusSource) : 'standby'
  const working = workState === 'working'
  const workHref = lead ? openEntityPath({ type: 'agent', id: lead.id, live: liveWork }) : '/agents'
  const summary = statusSource?.current_activity_summary || liveWork?.summary || null

  const identity = (
    <div className="flex min-w-0 items-start gap-2.5">
      {lead ? (
        <AiAvatar
          {...toAiAvatarProps(lead)}
          size={32}
          decorative
          activity={statusSource ? agentStatusOf(statusSource) : 'standby'}
        />
      ) : null}
      <div className="min-w-0 flex-1">
        {lead ? (
          <>
            <p className="truncate-fade text-sm font-medium text-text-heading">{lead.name}</p>
            <p className={cn('text-xs font-medium', presenceTextClass(workState))}>
              {presenceLabel(workState, t)}
            </p>
            {working ? (
              <>
                <AgentActiveLine at={statusSource?.last_active_at} working />
                {summary ? (
                  <p className="mt-0.5 line-clamp-2 text-xs text-text-secondary">{summary}</p>
                ) : null}
              </>
            ) : statusSource?.last_active_at ? (
              <AgentActiveLine at={statusSource.last_active_at} working={false} />
            ) : (
              <p className="mt-0.5 text-xs text-text-muted">{t('projects.detail.agentNotActiveYet')}</p>
            )}
          </>
        ) : (
          <p className="text-sm text-text-muted">{t('projects.home.noAgent')}</p>
        )}
      </div>
    </div>
  )

  if (!lead) return identity

  return (
    <Link
      to={workHref}
      className="block min-w-0 rounded-md -m-1 p-1 hover:bg-bg-hover/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
    >
      {identity}
    </Link>
  )
}

export default ProjectOrchestratorSection
