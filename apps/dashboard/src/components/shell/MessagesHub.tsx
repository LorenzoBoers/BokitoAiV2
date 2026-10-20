import { Outlet } from 'react-router-dom'
import { Eye, PenLine } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import MessagesHubNav from '../inbox/MessagesHubNav'
import SidebarCustomizeDialog from '../inbox/SidebarCustomizeDialog'
import { SidebarEditorProvider, useSidebarEditor } from '../../context/SidebarEditorContext'
import { SidebarPrefsProvider } from '../../context/SidebarPrefsContext'
import { SplitPane, SplitRow } from '../ui/SplitRow'

/**
 * Communication hub layout: customizable inner rail (Today, All
 * communication, pinned teams, Settings), thread list and conversation on
 * the right. New conversation lives on the main rail only.
 */
function MessagesHubFrame() {
  const { t } = useTranslation(['nav', 'communication'])
  const { openEditor } = useSidebarEditor()

  return (
    <>
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
            <div className="flex shrink-0 items-center gap-0.5 pb-1.5">
              <span className="min-w-0 flex-1 truncate px-2 text-sm font-medium text-text-heading">
                {t('tabs.communication.title')}
              </span>
              <button
                type="button"
                onClick={() => openEditor()}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-bg-hover/70 hover:text-text-primary"
                aria-label={t('support.customize.title')}
                data-testid="customize-sidebar"
              >
                <span className="relative inline-flex h-3.5 w-3.5 items-center justify-center" aria-hidden>
                  <Eye size={14} strokeWidth={1.75} />
                  <PenLine
                    size={8}
                    strokeWidth={2.4}
                    className="absolute -bottom-0.5 -right-0.5 rounded-sm bg-bg"
                  />
                </span>
              </button>
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
      <SidebarCustomizeDialog />
    </>
  )
}

export default function MessagesHub() {
  return (
    <SidebarPrefsProvider>
      <SidebarEditorProvider>
        <MessagesHubFrame />
      </SidebarEditorProvider>
    </SidebarPrefsProvider>
  )
}
