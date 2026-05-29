import { useEffect, useMemo, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useProjectHubNav } from '../../context/ProjectHubNavContext'
import { Badge } from '../ui/badge'
import { AiAvatar } from '../ui/AiAvatar'

const DEFAULT_VISIBLE_COUNT = 6

function rowClass(isActive: boolean) {
  return cn(
    'flex items-start gap-2.5 rounded-lg border px-3 py-2 text-[13px] transition-all',
    isActive
      ? 'border-border/70 bg-bg-hover/85 shadow-[0_1px_0_rgba(255,255,255,0.08)_inset,0_8px_18px_-14px_rgba(15,23,42,0.4)]'
      : 'border-transparent hover:border-border/60 hover:bg-bg-hover/55',
  )
}

function formatLastActive(value?: string | number | null, locale?: string): string | null {
  if (value == null || value === '' || value === 0) return null
  const date = new Date(typeof value === 'number' ? value : value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString(locale)
}

function formatWorkstreamsError(message: string, t: (key: string, opts?: { defaultValue?: string }) => string): string {
  if (/404|not found/i.test(message)) {
    return t('backgroundWorkers.apiUnavailable', {
      defaultValue: 'Workstreams are not available yet. Try refreshing in a moment.',
    })
  }
  return message
}

export default function ProjectHubBackgroundWorkersNav() {
  const { t, i18n } = useTranslation('nav')
  const { pathname, search } = useLocation()
  const {
    selectedProjectId,
    workstreams,
    poAgent,
    workstreamsLoading,
    workstreamsError,
  } = useProjectHubNav()
  const [showAll, setShowAll] = useState(false)

  const activeStreamSlug = useMemo(() => {
    const params = new URLSearchParams(search)
    return params.get('stream')
  }, [search])

  const activeIndex = useMemo(
    () => (activeStreamSlug ? workstreams.findIndex((stream) => stream.slug === activeStreamSlug) : -1),
    [activeStreamSlug, workstreams],
  )

  useEffect(() => {
    if (activeIndex >= DEFAULT_VISIBLE_COUNT) setShowAll(true)
  }, [activeIndex])

  const hasMore = workstreams.length > DEFAULT_VISIBLE_COUNT
  const visibleStreams = showAll ? workstreams : workstreams.slice(0, DEFAULT_VISIBLE_COUNT)
  const hiddenCount = workstreams.length - DEFAULT_VISIBLE_COUNT
  const projectBase = selectedProjectId ? `/project/${selectedProjectId}/overview` : null

  return (
    <section className="space-y-1 border-t border-border/40 pt-3">
      {selectedProjectId ? (
        <div className="px-3 pb-2">
          <p className="pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
            {t('projectHub.po.label', { defaultValue: 'Project PO' })}
          </p>
          {poAgent ? (
            <Link
              to={`/ai/agents/${poAgent.id}`}
              className="flex items-center gap-2 rounded-lg border border-border/60 px-2.5 py-2 transition-colors hover:bg-bg-hover/55"
            >
              <AiAvatar name={poAgent.name} seed={poAgent.id} size={22} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-text-heading">{poAgent.name}</span>
                <span className="mt-0.5 flex items-center gap-1.5">
                  <Badge variant="secondary" className="text-[10px]">
                    {t('workforce.agents.types.po', { defaultValue: 'PO' })}
                  </Badge>
                  {poAgent.status ? (
                    <span className="truncate text-xs capitalize text-text-muted">{poAgent.status}</span>
                  ) : null}
                </span>
              </span>
            </Link>
          ) : (
            <p className="px-1 text-xs text-text-muted">
              {t('projectHub.po.none', { defaultValue: 'No PO agent linked to this project yet.' })}
            </p>
          )}
        </div>
      ) : null}

      <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
        {t('backgroundWorkers.label')}
      </p>
      <div className="space-y-0.5">
        {!selectedProjectId ? (
          <p className="px-3 py-1 text-xs text-text-muted">
            {t('projectHub.selector.placeholder', { defaultValue: 'Select project' })}
          </p>
        ) : workstreamsLoading ? (
          <p className="px-3 py-1 text-xs text-text-muted">{t('backgroundWorkers.loading')}</p>
        ) : workstreamsError ? (
          <p className="px-3 py-1 text-xs text-status-error">
            {formatWorkstreamsError(workstreamsError, t)}
          </p>
        ) : workstreams.length === 0 ? (
          <p className="px-3 py-1 text-xs text-text-muted">{t('backgroundWorkers.empty')}</p>
        ) : (
          <>
            {visibleStreams.map((stream) => {
              const to = projectBase ? `${projectBase}?stream=${encodeURIComponent(stream.slug)}` : '#'
              const overviewPath = selectedProjectId ? `/project/${selectedProjectId}/overview` : null
              const effectiveSlug = activeStreamSlug ?? workstreams[0]?.slug ?? null
              const isActive =
                Boolean(overviewPath) &&
                pathname === overviewPath &&
                stream.slug === effectiveSlug
              const lastActive = formatLastActive(stream.last_active_at, i18n.language)

              return (
                <NavLink key={stream.id} to={to} className={() => rowClass(isActive)}>
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-text-muted/50" />
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        'block truncate font-medium',
                        isActive ? 'text-text-heading' : 'text-text-primary',
                      )}
                      title={stream.name}
                    >
                      {stream.name}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-text-muted capitalize">
                      {stream.status}
                      {lastActive
                        ? ` · ${t('backgroundWorkers.lastActive', { defaultValue: 'Last active {{time}}', time: lastActive })}`
                        : ` · ${t('backgroundWorkers.notActiveYet', { defaultValue: 'Not active yet' })}`}
                    </span>
                  </span>
                </NavLink>
              )
            })}
            {hasMore ? (
              <button
                type="button"
                onClick={() => setShowAll((value) => !value)}
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
