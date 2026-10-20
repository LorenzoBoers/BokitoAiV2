import { CanvasHost } from '../project-canvas/CanvasHost'

export function ProjectCanvasBoard({
  projectId,
  projectName,
  agentId,
  canEdit = false,
}: {
  projectId: string
  projectName?: string | null
  agentId?: string | null
  canEdit?: boolean
}) {
  return (
    <CanvasHost
      ownerId={projectId}
      ownerLabel={projectName}
      fallbackAgentId={agentId}
      canEdit={canEdit}
    />
  )
}
