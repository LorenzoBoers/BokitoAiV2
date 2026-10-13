import { ProjectAgendaCard } from './ProjectAgendaCard'
import type { ProjectRow } from '../../lib/projects-api'

/** Agenda on the map home. Nested maps live in the Mappen grid above (ProjectFolderGrid). */
export function ProjectHome({
  project,
}: {
  project: ProjectRow
  canEdit: boolean
  onChanged: () => Promise<void>
}) {
  return (
    <div className="max-w-md">
      <ProjectAgendaCard projectId={project.id} />
    </div>
  )
}
