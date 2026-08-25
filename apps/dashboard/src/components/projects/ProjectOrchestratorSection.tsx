import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Copy } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../ui/button'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import {
  createProjectPoAgent,
  linkProjectPoAgentById,
  type ProjectRow,
} from '../../lib/projects-api'

/**
 * Shows the linked lead (with a link to its agent page) or a picker to
 * link an existing agent / create a fresh lead for the project.
 */
export function ProjectOrchestratorSection({
  project,
  agents,
  onChanged,
}: {
  project: ProjectRow
  agents: Array<{ id: string; name: string }>
  onChanged: () => Promise<void>
}) {
  const { t } = useTranslation('nav')
  const [linking, setLinking] = useState(false)

  const linkLead = async (agentId: string) => {
    setLinking(true)
    try {
      if (agentId === '__create__') {
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

  const copyLeadId = async () => {
    if (!project.po_agent) return
    try {
      await navigator.clipboard.writeText(project.po_agent.id)
      toast.success(t('projects.detail.copied', { label: t('projects.detail.copyLeadId') }))
    } catch {
      toast.error(t('projects.detail.copyError', { label: t('projects.detail.copyLeadId') }))
    }
  }

  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-text-muted">{t('projects.detail.leadLabel')}</Label>
      {project.po_agent ? (
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/agents/${project.po_agent.id}`} className="text-sm text-accent hover:underline">
            {project.po_agent.name}
          </Link>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void copyLeadId()}
          >
            <Copy size={14} className="mr-1" />
            {t('projects.detail.copyIdShort')}
          </Button>
        </div>
      ) : (
        <Select disabled={linking} onValueChange={(value) => void linkLead(value)}>
          <SelectTrigger>
            <SelectValue placeholder={t('projects.detail.leadPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__create__">{t('projects.detail.leadCreate')}</SelectItem>
            {agents.map((agent) => (
              <SelectItem key={agent.id} value={agent.id}>
                {agent.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  )
}

export default ProjectOrchestratorSection
