import { useEffect, useMemo, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'
import { AiAvatar } from '../ui/AiAvatar'
import { listAgents } from '../../lib/agents-api'
import type { RuntimeAgent } from '../../lib/workforce-api'
import {
  filterUserAgents,
  resolvePoNavTarget,
  sortAgentsByUpdated,
} from '../../lib/workforce-nav-agents'
import { WORKFORCE_DEFAULT_PATH, WORKFORCE_PO_PATH } from './portal-nav'
import { useIsAdmin } from '../../hooks/useIsAdmin'
import NavCountBadge from './NavCountBadge'
import { useNavBadges } from '../../context/NavBadgeContext'
import { countForBadgeSlot } from '../../lib/nav-badge-counts'

const DEFAULT_VISIBLE_COUNT = 4

const STATUS_CLASS: Record<RuntimeAgent['status'], string> = {
  active: 'text-status-success',
  standby: 'text-text-muted',
  sleeping: 'text-text-muted',
  error: 'text-status-error',
}

function rowClass(isActive: boolean) {
  return cn(
    'flex items-start gap-2.5 rounded-lg border px-3 py-2 text-[13px] transition-all',
    isActive
      ? 'border-border/70 bg-bg-hover/85 shadow-[0_1px_0_rgba(255,255,255,0.08)_inset,0_8px_18px_-14px_rgba(15,23,42,0.4)]'
      : 'border-transparent hover:border-border/60 hover:bg-bg-hover/55',
  )
}

function compactLinkClass(isActive: boolean) {
  return cn(
    'flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-all',
    isActive
      ? 'border-border/70 bg-bg-hover/85 text-text-heading shadow-[0_1px_0_rgba(255,255,255,0.08)_inset,0_8px_18px_-14px_rgba(15,23,42,0.4)]'
      : 'border-transparent text-text-secondary hover:border-border/60 hover:bg-bg-hover/55 hover:text-text-primary',
  )
}

function isAgentDetailActive(pathname: string, agentId: string): boolean {
  const prefix = `/ai/agents/${agentId}`
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

export default function WorkforceSidebarNav() {
  const { t } = useTranslation('nav')
  const { pathname } = useLocation()
  const isAdmin = useIsAdmin()
  const { counts } = useNavBadges()
  const agentsBadge = countForBadgeSlot(counts, 'agents')

  const [agents, setAgents] = useState<RuntimeAgent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

  const poNavTarget = useMemo(() => resolvePoNavTarget(agents), [agents])
  const userAgents = useMemo(() => sortAgentsByUpdated(filterUserAgents(agents)), [agents])

  const activeAgentId = pathname.match(/^\/ai\/agents\/([^/]+)/)?.[1] ?? null
  const activeIndex = useMemo(
    () => (activeAgentId ? userAgents.findIndex((a) => a.id === activeAgentId) : -1),
    [activeAgentId, userAgents],
  )

  useEffect(() => {
    if (!isAdmin) return
    let cancelled = false
    setLoading(true)
    setError(null)
    listAgents()
      .then((rows) => {
        if (!cancelled) setAgents(rows)
      })
      .catch((e) => {
        if (!cancelled) {
          setAgents([])
          setError(e instanceof Error ? e.message : t('workforce.agents.loadError'))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isAdmin, t])

  useEffect(() => {
    if (activeIndex >= DEFAULT_VISIBLE_COUNT) setShowAll(true)
  }, [activeIndex])

  if (!isAdmin) return null

  const hasMore = userAgents.length > DEFAULT_VISIBLE_COUNT
  const visibleAgents = showAll ? userAgents : userAgents.slice(0, DEFAULT_VISIBLE_COUNT)
  const hiddenCount = userAgents.length - DEFAULT_VISIBLE_COUNT

  const poActive =
    (poNavTarget != null && pathname === poNavTarget) ||
    pathname.startsWith(`${poNavTarget}/`) ||
    pathname === WORKFORCE_PO_PATH

  return (
    <div className="space-y-4">
      {poNavTarget ? (
        <section className="space-y-0.5">
          <NavLink to={poNavTarget} className={() => compactLinkClass(poActive)}>
            <AiAvatar
              name={t('workforce.links.po', { defaultValue: 'PO agent' })}
              seed="platform:po"
              size={20}
            />
            <span className="truncate">{t('workforce.links.po', { defaultValue: 'PO agent' })}</span>
          </NavLink>
        </section>
      ) : !loading ? (
        <p className="px-3 py-0.5 text-xs text-text-muted">
          {t('workforce.po.none', { defaultValue: 'No PO agent configured yet.' })}
        </p>
      ) : null}

      <section className="space-y-1 border-t border-border/40 pt-3">
        <div className="flex items-center gap-2 px-3 pb-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
            {t('workforce.group.yourAgents', { defaultValue: 'Your agents' })}
          </p>
          {agentsBadge > 0 ? <NavCountBadge count={agentsBadge} placement="inline" /> : null}
        </div>
        <div className="space-y-0.5">
          {loading ? (
            <p className="px-3 py-1 text-xs text-text-muted">{t('workforce.agents.sidebar.loading')}</p>
          ) : error ? (
            <p className="px-3 py-1 text-xs text-status-error">{error}</p>
          ) : userAgents.length === 0 ? (
            <p className="px-3 py-1 text-xs text-text-muted">{t('workforce.agents.empty')}</p>
          ) : (
            <>
              {visibleAgents.map((agent) => {
                const to = `/ai/agents/${agent.id}`
                const isActive = isAgentDetailActive(pathname, agent.id)

                return (
                  <NavLink key={agent.id} to={to} className={() => rowClass(isActive)}>
                    <AiAvatar name={agent.name} seed={agent.id} size={22} className="mt-0.5" />
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          'block truncate font-medium',
                          isActive ? 'text-text-heading' : 'text-text-primary',
                        )}
                        title={agent.name}
                      >
                        {agent.name}
                      </span>
                      <span
                        className={cn(
                          'mt-0.5 block truncate text-xs capitalize',
                          STATUS_CLASS[agent.status],
                        )}
                      >
                        {t(`workforce.agents.status.${agent.status}`, { defaultValue: agent.status })}
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
                    ? t('workforce.agents.sidebar.showLess')
                    : t('workforce.agents.sidebar.showMore', { count: hiddenCount })}
                </button>
              ) : null}
              <NavLink
                to={WORKFORCE_DEFAULT_PATH}
                className={() =>
                  compactLinkClass(
                    pathname === WORKFORCE_DEFAULT_PATH || pathname === '/ai/agents',
                  )
                }
              >
                <span className="truncate">{t('workforce.links.viewAllAgents', { defaultValue: 'View all agents' })}</span>
              </NavLink>
            </>
          )}
        </div>
      </section>
    </div>
  )
}
