import type { ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { ChevronDown, Inbox, Plus, Settings, Users, UsersRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { NavSectionSkeleton } from '../ui/skeleton'
import { useNavBadges } from '../../context/NavBadgeContext'
import { useSidebarPrefs } from '../../context/SidebarPrefsContext'
import { useInboxFolderPrefs } from '../../hooks/useInboxFolderPrefs'
import { countForInboxQueue, countForTeam } from '../../lib/nav-badge-counts'
import type { SidebarSection } from '../../lib/communication-sidebar-prefs'
import {
  inboxPath,
  leafFromPath,
  leafKey,
  newConversationPath,
  type HubLeaf,
  type InboxQueue,
} from '../../lib/messages-paths'
import type { Team } from '../../lib/teams-api'
import { useTeams } from '../../hooks/useTeams'
import { SidebarFolder } from './QueueSublist'
import NavCountBadge from '../layout/NavCountBadge'
import ScrollFade from '../ui/ScrollFade'

const EXTRA_INBOX_ITEMS: ReadonlyArray<{ queue: InboxQueue; labelKey: string }> = [
  { queue: 'snoozed', labelKey: 'support.inbox.snoozed' },
  { queue: 'spam', labelKey: 'support.inbox.spam' },
]

export const SECTION_LABELS: Record<SidebarSection, { labelKey: string; defaultLabel: string }> = {
  teams: { labelKey: 'support.section.teams', defaultLabel: 'Teams' },
  settings: { labelKey: 'support.section.settings', defaultLabel: 'Settings' },
}

function isLeafActive(activeLeaf: HubLeaf | null, leaf: HubLeaf): boolean {
  return activeLeaf != null && leafKey(activeLeaf) === leafKey(leaf)
}

type CollapsibleSectionProps = {
  section: SidebarSection
  title: string
  headerAction?: ReactNode
  children: ReactNode
}

/** Square gear control — fixed size so hover/hitbox stay circular, not a thin strip. */
function SectionGearLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      title={label}
      aria-label={label}
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-bg-hover/70 hover:text-text-secondary"
      onClick={(e) => e.stopPropagation()}
    >
      <Settings size={12} strokeWidth={2} aria-hidden />
    </Link>
  )
}

/** Section header with persisted collapse state from sidebar prefs. */
function CollapsibleSection({ section, title, headerAction, children }: CollapsibleSectionProps) {
  const { prefs, setSectionCollapsed } = useSidebarPrefs()
  const collapsed = prefs.collapsed.includes(section)
  const open = !collapsed

  return (
    <section data-section={section} className="group/section space-y-px">
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => setSectionCollapsed(section, !collapsed)}
          className="nav-folder min-w-0 flex-1"
          aria-expanded={open}
          data-open={open ? 'true' : 'false'}
        >
          <ChevronDown aria-hidden />
          <span className="min-w-0 shrink truncate-fade text-left">{title}</span>
          <span className="min-w-0 flex-1" aria-hidden />
        </button>
        {headerAction ? (
          <span className="inline-flex shrink-0 opacity-0 transition-opacity focus-within:opacity-100 group-hover/section:opacity-100 group-focus-within/section:opacity-100">
            {headerAction}
          </span>
        ) : null}
      </div>
      <div className="nav-fold" data-open={open ? 'true' : undefined} aria-hidden={!open}>
        <div className="nav-fold-inner space-y-0.5">{children}</div>
      </div>
    </section>
  )
}

function usePinnedTeams(): { teams: Team[]; loading: boolean } {
  const { teams, loading } = useTeams()
  return { teams: teams.filter((team) => team.pinned), loading }
}

/**
 * Communication hub inner rail.
 *
 * Fixed top: New chat + All communication (For you, Open, Unassigned, Closed,
 * Snoozed, Spam). Middle: pinned teams with the same sub-folders. Anchored
 * bottom: Contacts + Settings.
 *
 * Channels and agents narrow the list as chips above it, so they are not
 * folders here. Agent runs surface in the conversation that needs a person.
 */
export default function MessagesHubNav() {
  const { t } = useTranslation('nav')
  const { counts } = useNavBadges()
  const { visibleSections, settingsVisible } = useSidebarPrefs()
  const { defaultQueueFor } = useInboxFolderPrefs()
  const location = useLocation()
  const activeLeaf = leafFromPath(location.pathname)
  const { teams, loading: teamsLoading } = usePinnedTeams()

  const inboxBaseLeaf: HubLeaf = { type: 'inbox' }
  const inboxQueueCounts = {
    for_you: counts.inboxByQueue.forYou,
    unassigned: counts.inboxByQueue.unassigned,
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScrollFade className="space-y-3 pb-1">
        <section>
          <NavLink
            to={newConversationPath()}
            className="nav-row border border-border/70 bg-bg-surface text-text-heading hover:border-border-light"
          >
            <Plus aria-hidden />
            <span>{t('support.newChat')}</span>
          </NavLink>
        </section>

        <section className="space-y-px">
          <SidebarFolder
            baseLeaf={inboxBaseLeaf}
            label={t('support.inbox.allCommunication')}
            title={t('support.inbox.allCommunicationHint')}
            icon={<Inbox size={14} className="shrink-0 text-text-muted" />}
            activeLeaf={activeLeaf}
            defaultQueue={defaultQueueFor(inboxBaseLeaf)}
            badgeCount={counts.inboxByQueue.forYou}
            queueCounts={inboxQueueCounts}
            extra={
              <>
                {EXTRA_INBOX_ITEMS.map((item) => {
                  const leaf: HubLeaf = { type: 'inbox', queue: item.queue }
                  return (
                    <NavLink
                      key={item.queue}
                      to={inboxPath(item.queue)}
                      title={t(`${item.labelKey}Hint`)}
                      data-active={isLeafActive(activeLeaf, leaf) ? 'true' : undefined}
                      className="nav-row nav-sub-row h-[26px] text-xs"
                    >
                      <span className="min-w-0 flex-1 truncate-fade">{t(item.labelKey)}</span>
                      <NavCountBadge count={countForInboxQueue(counts, item.queue)} placement="inline" />
                    </NavLink>
                  )
                })}
              </>
            }
          />
        </section>

        {visibleSections.includes('teams') ? (
          <CollapsibleSection
            section="teams"
            title={t(SECTION_LABELS.teams.labelKey)}
            headerAction={<SectionGearLink to="/team" label={t('support.teams.settingsAria')} />}
          >
            {teamsLoading ? <NavSectionSkeleton rows={2} /> : null}
            {!teamsLoading && teams.length === 0 ? (
              <Link to="/team" className="nav-row border border-dashed border-border/80 text-xs">
                <Plus aria-hidden />
                <span className="min-w-0 flex-1 truncate-fade">{t('support.teams.pinHint')}</span>
              </Link>
            ) : null}
            {teams.map((team) => {
              const leaf: HubLeaf = { type: 'team', teamId: team.id }
              return (
                <SidebarFolder
                  key={team.id}
                  baseLeaf={leaf}
                  label={team.name}
                  title={team.description || team.name}
                  icon={<UsersRound size={14} className="shrink-0 text-text-muted" />}
                  activeLeaf={activeLeaf}
                  defaultQueue={defaultQueueFor(leaf)}
                  badgeCount={countForTeam(counts, team.id)}
                />
              )
            })}
          </CollapsibleSection>
        ) : null}
      </ScrollFade>

      <div className="mt-1 shrink-0 space-y-px border-t border-border/60 pt-1.5">
        <NavLink to="/contacts" title={t('support.contacts.hint')} className="nav-row">
          <Users aria-hidden />
          <span className="min-w-0 flex-1 truncate-fade">{t('support.contacts.label')}</span>
        </NavLink>
        {settingsVisible ? (
          <NavLink to="/settings/channels" title={t('support.settings.channels')} className="nav-row">
            <Settings aria-hidden />
            <span className="min-w-0 flex-1 truncate-fade">{t('support.settings.channels')}</span>
          </NavLink>
        ) : null}
      </div>
    </div>
  )
}
