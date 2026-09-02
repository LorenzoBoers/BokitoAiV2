import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import ContentHeader from './ContentHeader'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'
import { WEBSITE_WIDGET_PATH } from '../../lib/assistant-settings-path'
import { useOnboardingStatus } from '../onboarding/OnboardingChecklist'

type SettingsLink = { labelKey: string; to: string; match?: string | string[]; hintKey?: string }
type SettingsGroup = { labelKey: string; links: SettingsLink[] }

const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    labelKey: 'settings.groups.personal',
    links: [
      { labelKey: 'settings.links.profileSecurity', to: '/settings/profile', hintKey: 'settings.hints.profileSecurity' },
      { labelKey: 'settings.links.notifications', to: '/settings/notifications', hintKey: 'settings.hints.notifications' },
    ],
  },
  {
    labelKey: 'settings.groups.workspace',
    links: [
      { labelKey: 'settings.links.setupGuide', to: '/settings/setup', hintKey: 'settings.hints.setupGuide' },
      { labelKey: 'settings.links.general', to: '/settings/general', hintKey: 'settings.hints.general' },
      { labelKey: 'settings.links.branding', to: '/settings/branding', hintKey: 'settings.hints.branding' },
      { labelKey: 'settings.links.members', to: '/settings/members', hintKey: 'settings.hints.members' },
    ],
  },
  {
    labelKey: 'settings.groups.communication',
    links: [
      { labelKey: 'settings.links.emailMessages', to: '/settings/channels', hintKey: 'settings.hints.emailMessages' },
      { labelKey: 'settings.links.chatWidget', to: WEBSITE_WIDGET_PATH, match: '/ai/assistant', hintKey: 'settings.hints.chatWidget' },
      { labelKey: 'settings.links.inboxAi', to: '/settings/communication', match: '/settings/communication', hintKey: 'settings.hints.inboxAi' },
    ],
  },
  {
    labelKey: 'settings.groups.govern',
    links: [
      { labelKey: 'settings.links.govern', to: '/settings/govern', hintKey: 'settings.hints.govern' },
      { labelKey: 'settings.links.trust', to: '/settings/trust', hintKey: 'settings.hints.trust' },
    ],
  },
  {
    labelKey: 'settings.groups.advanced',
    links: [
      { labelKey: 'settings.links.developers', to: '/settings/developers', hintKey: 'settings.hints.developers' },
      { labelKey: 'settings.links.models', to: '/settings/models', hintKey: 'settings.hints.models' },
    ],
  },
]

export const SETTINGS_PALETTE_LINKS: SettingsLink[] = [
  ...SETTINGS_GROUPS.flatMap((group) => group.links),
  // Connections live in the Modules hub; keep them findable from the palette.
  {
    labelKey: 'settings.links.integrations',
    to: '/modules/connected',
    hintKey: 'settings.hints.integrations',
  },
  {
    labelKey: 'integrations.links.marketplace',
    to: '/modules/marketplace',
    hintKey: 'settings.hints.marketplace',
  },
  {
    labelKey: 'integrations.links.mcp',
    to: '/modules/connected',
    hintKey: 'settings.hints.connectedTools',
  },
]

export function settingsLinkForPath(pathname: string): SettingsLink | undefined {
  return SETTINGS_PALETTE_LINKS.find((link) => linkIsActive(pathname, link))
}

function linkIsActive(pathname: string, link: SettingsLink): boolean {
  if (link.match) {
    const patterns = Array.isArray(link.match) ? link.match : [link.match]
    return patterns.some((pattern) => pathname.startsWith(pattern))
  }
  return pathname === link.to || pathname.startsWith(`${link.to}/`)
}

/** Rail and `/settings` land on the setup guide until onboarding is complete. */
export function SettingsHomeRedirect() {
  const { status, loading } = useOnboardingStatus()
  if (loading) return null
  if (status && !status.completed) return <Navigate to="/settings/setup" replace />
  return <Navigate to="/settings/general" replace />
}

export default function SettingsLayout() {
  const { pathname } = useLocation()
  const { t } = useTranslation('nav')
  const activeLink = SETTINGS_GROUPS.flatMap((group) => group.links).find((link) =>
    linkIsActive(pathname, link),
  )
  const activeLabel = activeLink ? t(activeLink.labelKey) : t('tabs.settings.subtitle')

  const subtitle = activeLabel

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <aside className="hidden w-[240px] shrink-0 flex-col border-r border-border/40 bg-bg-sidebar/50 px-2.5 py-3 lg:flex">
        <p className="px-2.5 pb-3 text-[15px] font-semibold leading-none text-text-heading">
          {t('tabs.settings.title')}
        </p>
        <nav className="min-h-0 flex-1 overflow-y-auto" aria-label={t('tabs.settings.title')}>
          <SettingsNav pathname={pathname} />
        </nav>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <nav
          className="shrink-0 overflow-x-auto border-b border-border/40 bg-bg-sidebar/50 px-3 py-2 lg:hidden"
          aria-label={t('tabs.settings.title')}
        >
          <SettingsNav pathname={pathname} compact />
        </nav>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8 pt-5 lg:px-8">
          <ContentHeader title={t('tabs.settings.title')} subtitle={subtitle} />
          <Outlet />
        </div>
      </div>
    </div>
  )
}

function SettingsNav({ pathname, compact = false }: { pathname: string; compact?: boolean }) {
  const { t } = useTranslation('nav')
  return (
    <TooltipProvider delayDuration={250}>
      <div className={compact ? 'flex flex-row flex-wrap gap-x-4 gap-y-2' : 'flex flex-col gap-y-5'}>
        {SETTINGS_GROUPS.map((group) => (
          <section key={group.labelKey} className={compact ? 'min-w-[140px]' : undefined}>
            <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">
              {t(group.labelKey)}
            </p>
            <div className="space-y-px">
              {group.links.map((link) => {
                const active = linkIsActive(pathname, link)
                const hint = link.hintKey ? t(link.hintKey) : ''
                const item = (
                  <NavLink
                    to={link.to}
                    className={`block rounded-lg px-2.5 py-1.5 text-[12.5px] transition-colors ${
                      active
                        ? 'bg-accent/12 font-medium text-accent'
                        : 'text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary'
                    }`}
                  >
                    {t(link.labelKey)}
                  </NavLink>
                )
                if (!hint) return <div key={link.to}>{item}</div>
                return (
                  <Tooltip key={link.to}>
                    <TooltipTrigger asChild>{item}</TooltipTrigger>
                    {/* Beside the rail so the hint never covers the next nav row. */}
                    <TooltipContent
                      side={compact ? 'top' : 'right'}
                      align="start"
                      sideOffset={8}
                      className="max-w-56 font-normal"
                    >
                      {hint}
                    </TooltipContent>
                  </Tooltip>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </TooltipProvider>
  )
}
