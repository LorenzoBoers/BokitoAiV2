import { useState } from 'react'
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

async function copyText(value: string, label: string) {
  try {
    await navigator.clipboard.writeText(value)
    toast.success(`${label} copied`)
  } catch {
    toast.error(`Could not copy ${label.toLowerCase()}`)
  }
}

/**
 * Shows the linked orchestrator (with a link to its agent page) or a picker to
 * link an existing agent / create a fresh orchestrator for the project.
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
  const [linking, setLinking] = useState(false)

  const linkOrchestrator = async (agentId: string) => {
    setLinking(true)
    try {
      if (agentId === '__create__') {
        await createProjectPoAgent(project.id, 'Project Orchestrator')
      } else {
        await linkProjectPoAgentById(project.id, agentId)
      }
      toast.success('Orchestrator linked')
      await onChanged()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, 'Could not link orchestrator.'))
    } finally {
      setLinking(false)
    }
  }

  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-text-muted">Orchestrator agent</Label>
      {project.po_agent ? (
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/agents/${project.po_agent.id}`} className="text-sm text-accent hover:underline">
            {project.po_agent.name}
          </Link>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void copyText(project.po_agent!.id, 'Orchestrator ID')}
          >
            <Copy size={14} className="mr-1" />
            Copy ID
          </Button>
        </div>
      ) : (
        <Select disabled={linking} onValueChange={(value) => void linkOrchestrator(value)}>
          <SelectTrigger>
            <SelectValue placeholder="Link orchestrator" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__create__">Create new orchestrator</SelectItem>
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
