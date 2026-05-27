import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'
import { getProjectTabLinks } from '../layout/portal-nav'
import { useProjectContext } from '../../context/ProjectContext'

function tabClass(isActive: boolean) {
  return cn(
    'shrink-0 rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-all',
    isActive
      ? 'border-border/70 bg-bg-hover/85 text-text-heading'
      : 'border-transparent text-text-secondary hover:border-border/60 hover:bg-bg-hover/55 hover:text-text-primary',
  )
}

export function ProjectTabNav() {
  const { t } = useTranslation('nav')
  const { projectId } = useProjectContext()
  const tabs = getProjectTabLinks(t, projectId)

  return (
    <nav
      className="mb-4 flex gap-1 overflow-x-auto border-b border-border/50 pb-2"
      aria-label={t('project.tabsAriaLabel', { defaultValue: 'Project sections' })}
    >
      {tabs.map((tab) => (
        <NavLink key={tab.to} to={tab.to} end className={({ isActive }) => tabClass(isActive)}>
          {tab.label}
        </NavLink>
      ))}
    </nav>
  )
}
