import { CanvasHost } from '../project-canvas/CanvasHost'

export function ProjectCanvasBoard({
  projectId,
  agentId,
  canEdit = false,
}: {
  projectId: string
  agentId?: string | null
  canEdit?: boolean
}) {
  return (
    <CanvasHost ownerKind="project" ownerId={projectId} fallbackAgentId={agentId} canEdit={canEdit} />
  )
}
