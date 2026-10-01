import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Settings2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import MessagesHubNav from '../inbox/MessagesHubNav'
import SidebarCustomizeDialog from '../inbox/SidebarCustomizeDialog'
import { PageGuideLink } from '../layout/PageGuideLink'
import { SidebarPrefsProvider } from '../../context/SidebarPrefsContext'
import { SplitPane, SplitRow } from '../ui/SplitRow'

/**
 * Communication hub layout: customizable inner rail (New chat, Inbox,
 * Assistant, Channels, Agents, Settings), thread list and
 * conversation on the right.
 */
export default function MessagesHub() {
  const { t } = useTranslation(['nav', 'communication'])
  const location = useLocation()
  const [customizeOpen, setCustomizeOpen] = useState(false)
  const runsGuide = location.pathname.includes('/communication/runs')

  return (
    <SidebarPrefsProvider>
      <SplitRow
        storageKey="bokito.split.messagesHub"
        minFlex={480}
        resetHint={t('split.resetHint', { ns: 'communication' })}
        className="h-full min-h-0"
      >
        <SplitPane
          id="nav"
          defaultWidth={232}
          minWidth={176}
          maxWidth={380}
          label={t('split.nav', { ns: 'communication' })}
          className="hidden md:flex"
        >
          <aside className="flex h-full min-h-0 w-full flex-col border-r border-border/60 bg-bg px-2 pb-2 pt-2.5">
            <div className="flex h-7 items-center justify-between pl-2 pr-0.5 pb-1">
              <p className="text-sm font-medium leading-none text-text-heading">{t('sectionTitle.inbox')}</p>
              <div className="flex items-center">
                <PageGuideLink
                  page="communication"
                  variant={runsGuide ? 'runs' : undefined}
                  compact
                  className="h-6 w-6"
                />
                <button
                  type="button"
                  onClick={() => setCustomizeOpen(true)}
                  className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-bg-hover/70 hover:text-text-primary"
                  aria-label={t('support.customize.title')}
                  data-testid="customize-sidebar"
                >
                  <Settings2 size={13} />
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <MessagesHubNav />
            </div>
          </aside>
        </SplitPane>
        <SplitPane id="main" defaultWidth={0} minWidth={0} maxWidth={0} flex>
          <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-hidden">
              <Outlet />
            </div>
          </div>
        </SplitPane>
      </SplitRow>
      <SidebarCustomizeDialog open={customizeOpen} onOpenChange={setCustomizeOpen} />
    </SidebarPrefsProvider>
  )
}
