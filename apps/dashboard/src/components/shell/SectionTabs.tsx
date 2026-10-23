import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  DEPARTMENTS_PATH,
  GRID_PATH,
  KNOWLEDGE_PATH,
  ORGANOGRAM_PATH,
  TAB_PATHS,
  WORKFLOW_PATH,
} from '../../lib/navigation'
import { cn } from '../../lib/utils'

export type SectionTab = {
  to: string
  label: string
  active: boolean
}

/** Tab strip shared by pages that live under one rail item. */
export function SectionTabs({ tabs, className }: { tabs: readonly SectionTab[]; className?: string }) {
  return (
    <nav className={cn('flex items-center gap-1 overflow-x-auto', className)} role="tablist">
      {tabs.map((tab) => (
        <Link
          key={tab.to}
          to={tab.to}
          role="tab"
          aria-selected={tab.active}
          className={cn(
            'shrink-0 rounded-md px-2.5 py-1 text-sm transition-colors',
            tab.active
              ? 'bg-bg-elevated font-medium text-text-heading'
              : 'text-text-muted hover:bg-bg-hover hover:text-text-primary',
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  )
}

/** Agents · Knowledge */
export function AgentsSectionTabs({ className }: { className?: string }) {
  const { t } = useTranslation('nav')
  const { pathname } = useLocation()
  const onKnowledge = pathname.startsWith(KNOWLEDGE_PATH)
  return (
    <SectionTabs
      className={className}
      tabs={[
        { to: TAB_PATHS.agents, label: t('tabs.agents.title'), active: !onKnowledge },
        { to: KNOWLEDGE_PATH, label: t('tabs.knowledge.title'), active: onKnowledge },
      ]}
    />
  )
}

/** People and agents · Departments · Grid · Workflow · Organogram */
export function WorkforceSectionTabs({ className }: { className?: string }) {
  const { t } = useTranslation('nav')
  const { pathname, search } = useLocation()
  const onGrid = pathname.startsWith(GRID_PATH)
  const onWorkflow = pathname.startsWith(WORKFLOW_PATH)
  const onOrganogram = pathname.startsWith(ORGANOGRAM_PATH)
  const onCanvas = onGrid || onWorkflow || onOrganogram
  const tab = new URLSearchParams(search).get('tab')
  const onDepartments = !onCanvas && (tab === 'departments' || tab === 'teams')
  return (
    <SectionTabs
      className={className}
      tabs={[
        { to: TAB_PATHS.team, label: t('teamPage.sections.people'), active: !onCanvas && !onDepartments },
        { to: DEPARTMENTS_PATH, label: t('teamPage.sections.teams'), active: onDepartments },
        { to: GRID_PATH, label: t('tabs.grid.title'), active: onGrid },
        { to: WORKFLOW_PATH, label: t('tabs.workflow.title'), active: onWorkflow },
        { to: ORGANOGRAM_PATH, label: t('tabs.organogram.title'), active: onOrganogram },
      ]}
    />
  )
}
