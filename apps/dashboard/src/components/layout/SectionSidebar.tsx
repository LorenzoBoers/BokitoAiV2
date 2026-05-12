import { NavLink, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { UserAvatar } from '../ui/UserAvatar'
import {
  Bell,
  BookOpen,
  Briefcase,
  Building,
  CreditCard,
  Database,
  Inbox,
  KeyRound,
  Link2,
  Mail,
  MessageSquare,
  Shield,
  Sparkles,
  Tag,
  UserCircle2,
  Users,
  Zap,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import {
  getAiSidebarGroups,
  getSettingsSidebarGroups,
  getUserSidebarGroups,
  getWorkforceSidebarGroups,
  type SidebarGroup,
} from './portal-nav'
import InboxSidebarNav from '../inbox/InboxSidebarNav'

function sectionClass(isActive: boolean) {
  return `flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-all ${
    isActive
      ? 'border-border/70 bg-bg-hover/85 text-text-heading shadow-[0_1px_0_rgba(255,255,255,0.08)_inset,0_8px_18px_-14px_rgba(15,23,42,0.4)]'
      : 'border-transparent text-text-secondary hover:border-border/60 hover:bg-bg-hover/55 hover:text-text-primary'
  }`
}

function iconForLink(to: string) {
  if (to.includes('/support/inbox')) return Inbox
  if (to.includes('/support/customization')) return Sparkles
  if (to.includes('/support/settings')) return Mail
  if (to.includes('/users/attributes')) return UserCircle2
  if (to.includes('/users/tags')) return Tag
  if (to.includes('/users/segments')) return Database
  if (to.includes('/users/lead-qualification')) return Shield
  if (to.includes('/users/blocked')) return KeyRound
  if (to.includes('/settings/profile')) return UserCircle2
  if (to.includes('/settings/notifications')) return Bell
  if (to.includes('/settings/support')) return Mail
  if (to.includes('/settings/messenger')) return MessageSquare
  if (to.includes('/settings/help-centers')) return BookOpen
  if (to.includes('/settings/general')) return Briefcase
  if (to.includes('/settings/branding')) return Building
  if (to.includes('/settings/members')) return Users
  if (to.includes('/settings/billing')) return CreditCard
  if (to.includes('/settings/access-security')) return Shield
  if (to.includes('/settings/inbox')) return Inbox
  if (to.includes('/settings/data/users')) return Users
  if (to.includes('/settings/data/companies')) return Building
  if (to.includes('/settings/data/conversations')) return MessageSquare
  if (to.includes('/settings/data/imports-exports')) return Database
  if (to.includes('/projects')) return BookOpen
  if (to.includes('/ai/assistent')) return MessageSquare
  if (to.includes('/ai/handelingen')) return Zap
  if (to.includes('/datasources')) return Link2
  if (to.includes('/workforce')) return Users
  return Inbox
}

function SidebarGroupBlock({ group, user }: { group: SidebarGroup; user: { name: string; email: string; avatarUrl?: string | null } | null }) {
  return (
    <section className="space-y-1">
      <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">{group.label}</p>
      <div className="space-y-0.5">
        {group.links.map((item) => {
          if (item.comingSoon) {
            return (
              <div key={item.to} className="flex items-center gap-2 rounded-lg border border-transparent px-3 py-1.5 text-[13px] font-medium opacity-40 cursor-not-allowed select-none">
                {(() => {
                  const Icon = iconForLink(item.to)
                  return <Icon size={14} className="text-text-muted shrink-0" />
                })()}
                <span>{item.label}</span>
                <span className="ml-auto rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-bg-hover text-text-muted">binnenkort</span>
              </div>
            )
          }
          return (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => sectionClass(isActive)}>
              {item.to === '/support/inbox/my' ? (
                <UserAvatar name={user?.name ?? '?'} email={user?.email ?? ''} avatarUrl={user?.avatarUrl} size={20} />
              ) : (
                (() => {
                  const Icon = iconForLink(item.to)
                  return <Icon size={14} className="text-text-muted" />
                })()
              )}
              <span>{item.label}</span>
            </NavLink>
          )
        })}
      </div>
    </section>
  )
}

function resolveGroups(pathname: string, t: (key: string) => string): SidebarGroup[] {
  if (pathname.startsWith('/settings') || pathname.startsWith('/integrations')) return getSettingsSidebarGroups(t)
  if (pathname.startsWith('/users') || pathname.startsWith('/database')) return getUserSidebarGroups(t)
  if (pathname.startsWith('/projects') || pathname.startsWith('/ai') || pathname.startsWith('/datasources')) return getAiSidebarGroups(t)
  if (pathname.startsWith('/workforce')) return getWorkforceSidebarGroups(t)
  return []
}

function resolveTitle(pathname: string, t: (key: string) => string): string {
  if (pathname.startsWith('/users') || pathname.startsWith('/database')) return t('nav:sectionTitle.data')
  if (pathname.startsWith('/settings') || pathname.startsWith('/integrations')) return t('nav:sectionTitle.settings')
  if (pathname.startsWith('/projects') || pathname.startsWith('/ai') || pathname.startsWith('/datasources')) return t('nav:sectionTitle.ai')
  if (pathname.startsWith('/workforce')) return t('nav:sectionTitle.workforce')
  return t('nav:sectionTitle.inbox')
}

export default function SectionSidebar() {
  const { t } = useTranslation(['nav'])
  const { user } = useAuth()
  const { pathname } = useLocation()
  const groups = resolveGroups(pathname, t)
  const title = resolveTitle(pathname, t)

  const isInbox = pathname.startsWith('/support') || pathname.startsWith('/communication')

  return (
    <aside className="flex h-full w-[248px] shrink-0 flex-col border-r border-border/55 bg-bg-sidebar px-3 py-3">
      <h2 className="px-3 pb-3 text-[22px] font-semibold leading-none text-text-heading">{title}</h2>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isInbox ? (
          <InboxSidebarNav />
        ) : (
          <div className="space-y-4">
            {groups.map((group) => (
              <SidebarGroupBlock key={group.label} group={group} user={user ?? null} />
            ))}
          </div>
        )}
      </div>
      {isInbox && (
        <div className="mt-2 space-y-0.5 border-t border-border/40 pt-2">
          <NavLink to="/settings/messenger" className={({ isActive }) => sectionClass(isActive)}>
            <MessageSquare size={14} className="text-text-muted" />
            <span>{t('nav:settings.links.messenger')}</span>
          </NavLink>
          <NavLink to="/settings/inbox" className={({ isActive }) => sectionClass(isActive)}>
            <Mail size={14} className="text-text-muted" />
            <span>{t('nav:settings.links.inbox')}</span>
          </NavLink>
        </div>
      )}
    </aside>
  )
}
