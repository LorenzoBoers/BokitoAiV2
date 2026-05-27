import type { ReactNode } from 'react'
import { WorkerStatusStrip } from '../workers/WorkerStatusStrip'
import { ProjectContextBar } from './ProjectContextBar'
import { ProjectTabNav } from './ProjectTabNav'

interface ProjectShellProps {
  children: ReactNode
  /** Constrain content width. Use `wide` for documentation, default for forms/overview. */
  width?: 'default' | 'wide' | 'full'
  /** Hide the context bar (e.g. on the documentation canvas where the page header takes over). */
  hideContextBar?: boolean
  /** Hide horizontal project section tabs. */
  hideTabNav?: boolean
  /** Hide worker operational status strip (above tabs). */
  hideWorkerStatus?: boolean
}

/**
 * Shared wrapper for `/project/:id/*` pages. Renders the slim context bar
 * (project name, repo status, primary actions) and a width-constrained
 * content column. `Layout.tsx` already supplies the outer scroll padding.
 */
export function ProjectShell({
  children,
  width = 'default',
  hideContextBar = false,
  hideTabNav = false,
  hideWorkerStatus = false,
}: ProjectShellProps) {
  const widthClass =
    width === 'full'
      ? 'w-full'
      : width === 'wide'
        ? 'mx-auto w-full max-w-[1200px]'
        : 'mx-auto w-full max-w-[1000px]'

  return (
    <div className={widthClass}>
      {hideContextBar ? null : <ProjectContextBar />}
      {hideWorkerStatus ? null : <WorkerStatusStrip />}
      {hideTabNav ? null : <ProjectTabNav />}
      {children}
    </div>
  )
}
