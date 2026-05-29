import { Outlet } from 'react-router-dom'
import { ProjectProvider } from '../../context/ProjectContext'

export default function ProjectLayout() {
  return (
    <ProjectProvider>
      <Outlet />
    </ProjectProvider>
  )
}
