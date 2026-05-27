import { useEffect, useMemo, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useProjectHubNav } from '../../context/ProjectHubNavContext'
import { WorkerStatusDot } from '../workers/WorkerStatusDot'
import { workerStatusTextClass, formatWorkerStatusLabel } from '../../lib/project-worker-status'

const DEFAULT_VISIBLE_COUNT = 4

function rowClass(isActive: boolean) {
  return cn(
    'flex items-start gap-2.5 rounded-lg border px-3 py-2 text-[13px] transition-all',
    isActive
      ? 'border-border/70 bg-bg-hover/85 shadow-[0_1px_0_rgba(255,255,255,0.08)_inset,0_8px_18px_-14px_rgba(15,23,42,0.4)]'
      : 'border-transparent hover:border-border/60 hover:bg-bg-hover/55',
  )
}

export default function ProjectHubBackgroundWorkersNav() {
  const { t, i18n } = useTranslation('nav')
  const { pathname } = useLocation()
  const { projects, loading, error, getWorkerStatus, statusLoading } = useProjectHubNav()
  const activeProjectId = pathname.match(/^\/project\/([^/]+)/)?.[1] ?? null
  const [showAll, setShowAll] = useState(false)

  const activeIndex = useMemo(
    () => (activeProjectId ? projects.findIndex((p) => p.id === activeProjectId) : -1),
    [activeProjectId, projects],
  )

  useEffect(() => {
    if (activeIndex >= DEFAULT_VISIBLE_COUNT) setShowAll(true)
  }, [activeIndex])

  const hasMore = projects.length > DEFAULT_VISIBLE_COUNT
  const visibleProjects = showAll ? projects : projects.slice(0, DEFAULT_VISIBLE_COUNT)
  const hiddenCount = projects.length - DEFAULT_VISIBLE_COUNT

  return (
    <section className="space-y-1 border-t border-border/40 pt-3">
      <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
        {t('backgroundWorkers.label')}
      </p>
      <div className="space-y-0.5">
        {loading ? (
          <p className="px-3 py-1 text-xs text-text-muted">{t('backgroundWorkers.loading')}</p>
        ) : error ? (
          <p className="px-3 py-1 text-xs text-status-error">{error}</p>
        ) : projects.length === 0 ? (
          <p className="px-3 py-1 text-xs text-text-muted">{t('backgroundWorkers.empty')}</p>
        ) : (
          <>
            {visibleProjects.map((p) => {
              const to = `/project/${p.id}/overview`
              const isActive = pathname === to || pathname.startsWith(`/project/${p.id}/`)
              const status = getWorkerStatus(p.id)
              const primary = status?.primary ?? 'idle'
              const badgeCount = status?.badgeCount ?? 0
              const statusLabel = status
                ? formatWorkerStatusLabel(status, t, i18n.language)
                : statusLoading
                  ? t('backgroundWorkers.status.loading')
                  : t('backgroundWorkers.status.idle')

              return (
                <NavLink key={p.id} to={to} className={() => rowClass(isActive)}>
                  <WorkerStatusDot
                    primary={primary}
                    badgeCount={badgeCount}
                    className="mt-1"
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        'block truncate font-medium',
                        isActive ? 'text-text-heading' : 'text-text-primary',
                      )}
                      title={p.name}
                    >
                      {p.name}
                    </span>
                    <span
                      className={cn(
                        'mt-0.5 block truncate text-xs',
                        workerStatusTextClass(primary),
                      )}
                    >
                      {statusLabel}
                    </span>
                  </span>
                </NavLink>
              )
            })}
            {hasMore ? (
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="w-full rounded-lg px-3 py-1.5 text-left text-xs font-medium text-text-muted hover:bg-bg-hover/55 hover:text-text-primary"
              >
                {showAll
                  ? t('backgroundWorkers.showLess')
                  : t('backgroundWorkers.showMore', { count: hiddenCount })}
              </button>
            ) : null}
          </>
        )}
        <NavLink
          to="/projects/new"
          className={({ isActive }) =>
            cn(rowClass(isActive), 'mt-1 border-dashed text-text-muted')
          }
        >
          <Plus size={14} className="mt-0.5 shrink-0" />
          <span className="font-medium">{t('backgroundWorkers.newProject')}</span>
        </NavLink>
      </div>
    </section>
  )
}
