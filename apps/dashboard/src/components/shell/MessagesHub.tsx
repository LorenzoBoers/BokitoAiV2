import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Settings2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import MessagesHubNav from '../inbox/MessagesHubNav'
import SidebarCustomizeDialog from '../inbox/SidebarCustomizeDialog'
import { PageGuideBanner } from '../layout/PageGuideBanner'
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
          <aside className="flex h-full min-h-0 w-full flex-col border-r border-border/40 bg-bg-sidebar/50 px-2.5 py-3">
            <div className="flex items-center justify-between px-2.5 pb-2">
              <p className="text-[15px] font-semibold leading-none text-text-heading">
                {t('sectionTitle.inbox')}
              </p>
              <button
                type="button"
                onClick={() => setCustomizeOpen(true)}
                className="rounded-md p-1 text-text-muted transition-colors hover:bg-bg-hover/70 hover:text-text-primary"
                aria-label={t('support.customize.title')}
                data-testid="customize-sidebar"
              >
                <Settings2 size={14} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <MessagesHubNav />
            </div>
          </aside>
        </SplitPane>
        <SplitPane id="main" defaultWidth={0} minWidth={0} maxWidth={0} flex>
          <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <div className="hidden shrink-0 md:block">
              <PageGuideBanner
                page="communication"
                variant={runsGuide ? 'runs' : undefined}
                className="mx-3 mt-3"
              />
            </div>
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
