import { Outlet, useParams } from 'react-router-dom'
import { ProjectProvider } from '../../context/ProjectContext'
import { ProjectDocNavProvider } from '../../context/ProjectDocNavContext'

export default function ProjectLayout() {
  const { projectId } = useParams<{ projectId: string }>()
  return (
    <ProjectProvider>
      <ProjectDocNavProvider projectId={projectId ?? null}>
        <Outlet />
      </ProjectDocNavProvider>
    </ProjectProvider>
  )
}
