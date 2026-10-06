import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Info, Trash2, type LucideIcon } from 'lucide-react'
import ContentHeader from './ContentHeader'
import ScrollFade from '../ui/ScrollFade'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'
import { MY_ASSISTANT_SETTINGS_PATH } from '../../lib/assistant-settings-path'
import { useOnboardingStatus } from '../onboarding/OnboardingChecklist'
import { cn } from '../../lib/utils'

type SettingsLink = { labelKey: string; to: string; match?: string | string[]; hintKey?: string }
type SettingsGroup = { labelKey: string; links: SettingsLink[]; accent?: boolean }

const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    labelKey: 'settings.groups.personal',
    links: [
      { labelKey: 'settings.links.profileSecurity', to: '/settings/profile', hintKey: 'settings.hints.profileSecurity' },
      { labelKey: 'settings.links.myAssistant', to: MY_ASSISTANT_SETTINGS_PATH, hintKey: 'settings.hints.myAssistant' },
      { labelKey: 'settings.links.notifications', to: '/settings/notifications', hintKey: 'settings.hints.notifications' },
    ],
  },
  {
    labelKey: 'settings.groups.workspace',
    links: [
      { labelKey: 'settings.links.general', to: '/settings/general', hintKey: 'settings.hints.general' },
      { labelKey: 'settings.links.branding', to: '/settings/branding', hintKey: 'settings.hints.branding' },
    ],
  },
  {
    labelKey: 'settings.groups.communication',
    links: [
      { labelKey: 'settings.links.emailMessages', to: '/settings/channels', match: '/settings/channels', hintKey: 'settings.hints.emailMessages' },
      { labelKey: 'settings.links.inboxAi', to: '/settings/communication', match: '/settings/communication', hintKey: 'settings.hints.inboxAi' },
      { labelKey: 'settings.links.categories', to: '/settings/action-tags', hintKey: 'settings.hints.categories' },
    ],
  },
  {
    labelKey: 'settings.groups.govern',
    links: [
      { labelKey: 'settings.links.govern', to: '/settings/govern', hintKey: 'settings.hints.govern' },
      { labelKey: 'settings.links.models', to: '/settings/models', hintKey: 'settings.hints.models' },
      { labelKey: 'settings.links.trust', to: '/settings/trust', hintKey: 'settings.hints.trust' },
    ],
  },
  {
    labelKey: 'settings.groups.advanced',
    links: [
      { labelKey: 'settings.links.developers', to: '/settings/developers', hintKey: 'settings.hints.developers' },
    ],
  },
  {
    labelKey: 'settings.groups.help',
    accent: true,
    links: [
      { labelKey: 'settings.links.help', to: '/settings/help', hintKey: 'settings.hints.help' },
    ],
  },
]

const BIN_LINK: SettingsLink = {
  labelKey: 'settings.links.bin',
  to: '/settings/bin',
  hintKey: 'settings.hints.bin',
}

export const SETTINGS_PALETTE_LINKS: SettingsLink[] = [
  ...SETTINGS_GROUPS.flatMap((group) => group.links),
  BIN_LINK,
  // Setup guide lives on Help; keep findable from the palette and deep links.
  {
    labelKey: 'settings.links.setupGuide',
    to: '/settings/setup',
    hintKey: 'settings.hints.setupGuide',
  },
  // Connections live in the hub; keep them findable from the palette.
  {
    labelKey: 'settings.links.integrations',
    to: '/connections',
    hintKey: 'settings.hints.integrations',
  },
  {
    labelKey: 'integrations.links.marketplace',
    to: '/connections/marketplace',
    hintKey: 'settings.hints.marketplace',
  },
  {
    labelKey: 'integrations.links.mcp',
    to: '/connections?kind=mcp',
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

/** Settings pages that render their own `ContentHeader` (title + controls). */
const OWN_HEADER_PATHS = ['/settings/govern', '/settings/trust', '/settings/bin', '/settings/models', '/settings/mcp-catalog']

export default function SettingsLayout() {
  const { pathname } = useLocation()
  const { t } = useTranslation('nav')
  const activeLink = SETTINGS_PALETTE_LINKS.find((link) => linkIsActive(pathname, link))
  const ownsHeader =
    OWN_HEADER_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`)) ||
    /^\/settings\/channels\/[^/]+/.test(pathname)
  // One title per page: the active section name, with its hint as subtitle.
  // The topbar breadcrumb already reads "Settings / {section}".
  const title = activeLink ? t(activeLink.labelKey) : t('tabs.settings.title')
  const subtitle = activeLink?.hintKey ? t(activeLink.hintKey) : undefined

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <aside className="hidden w-[220px] shrink-0 flex-col border-r border-border/60 bg-bg px-2 pb-2 pt-2.5 lg:flex">
        <p className="flex h-7 shrink-0 items-center pl-2 pb-1 text-sm font-medium leading-none text-text-heading">
          {t('tabs.settings.title')}
        </p>
        <ScrollFade className="pb-1">
          <nav className="flex min-h-0 flex-col" aria-label={t('tabs.settings.title')}>
            <SettingsNav pathname={pathname} />
          </nav>
        </ScrollFade>
        <TooltipProvider delayDuration={250}>
          <div className="mt-auto shrink-0">
            <SettingsPinnedLink pathname={pathname} link={BIN_LINK} icon={Trash2} className="pb-2.5" />
            <SettingsHelpLink pathname={pathname} className="border-t border-border/60 pt-2.5" />
          </div>
        </TooltipProvider>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <nav
          className="shrink-0 overflow-x-auto border-b border-border/60 bg-bg px-3 py-2 lg:hidden"
          aria-label={t('tabs.settings.title')}
        >
          <SettingsNav pathname={pathname} compact />
        </nav>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8 pt-4 lg:px-8">
          {ownsHeader ? null : <ContentHeader title={title} subtitle={subtitle} />}
          <Outlet />
        </div>
      </div>
    </div>
  )
}

function SettingsPinnedLink({
  pathname,
  link,
  icon: Icon,
  compact = false,
  className,
}: {
  pathname: string
  link: SettingsLink
  icon: LucideIcon
  compact?: boolean
  className?: string
}) {
  const { t } = useTranslation('nav')
  const active = linkIsActive(pathname, link)
  const hint = link.hintKey ? t(link.hintKey) : ''
  const item = (
    <NavLink to={link.to} className="nav-row" data-active={active ? 'true' : undefined}>
      <Icon aria-hidden />
      {t(link.labelKey)}
    </NavLink>
  )
  return (
    <div className={cn(compact ? 'min-w-[140px]' : 'w-full', className)}>
      {hint ? (
        <Tooltip>
          <TooltipTrigger asChild>{item}</TooltipTrigger>
          <TooltipContent
            side={compact ? 'top' : 'right'}
            align="start"
            sideOffset={8}
            className="max-w-56 font-normal"
          >
            {hint}
          </TooltipContent>
        </Tooltip>
      ) : (
        item
      )}
    </div>
  )
}

function SettingsHelpLink({
  pathname,
  compact = false,
  className,
}: {
  pathname: string
  compact?: boolean
  className?: string
}) {
  const helpGroup = SETTINGS_GROUPS.find((group) => group.accent)
  const link = helpGroup?.links[0]
  if (!link) return null
  return (
    <SettingsPinnedLink
      pathname={pathname}
      link={link}
      icon={Info}
      compact={compact}
      className={className}
    />
  )
}

function SettingsNav({ pathname, compact = false }: { pathname: string; compact?: boolean }) {
  const { t } = useTranslation('nav')
  const groups = compact
    ? SETTINGS_GROUPS
    : SETTINGS_GROUPS.filter((group) => !group.accent)
  return (
    <TooltipProvider delayDuration={250}>
      <div className={compact ? 'flex flex-row flex-wrap gap-x-4 gap-y-2' : 'flex min-h-0 flex-col gap-y-3'}>
        {groups.map((group) => {
          if (group.accent) {
            return (
              <div key={group.labelKey} className={compact ? 'flex items-center gap-x-4' : undefined}>
                <SettingsPinnedLink pathname={pathname} link={BIN_LINK} icon={Trash2} compact={compact} />
                <SettingsHelpLink
                  pathname={pathname}
                  compact={compact}
                  className={compact ? undefined : 'mt-2.5 border-t border-border/60 pt-2.5'}
                />
              </div>
            )
          }
          return (
            <section key={group.labelKey} className={compact ? 'min-w-[140px]' : undefined}>
              <p className="flex h-6 items-center px-2 text-xs text-text-muted">{t(group.labelKey)}</p>
              <div className="space-y-px">
                {group.links.map((link) => {
                  const active = linkIsActive(pathname, link)
                  const hint = link.hintKey ? t(link.hintKey) : ''
                  const item = (
                    <NavLink
                      to={link.to}
                      className={cn('nav-row', !compact && 'pl-4')}
                      data-active={active ? 'true' : undefined}
                    >
                      <span className="min-w-0 flex-1 truncate-fade">{t(link.labelKey)}</span>
                    </NavLink>
                  )
                  if (!hint) return <div key={link.to}>{item}</div>
                  return (
                    <Tooltip key={link.to}>
                      <TooltipTrigger asChild>{item}</TooltipTrigger>
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
          )
        })}
      </div>
    </TooltipProvider>
  )
}
