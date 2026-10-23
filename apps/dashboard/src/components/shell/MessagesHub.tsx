import { Button } from '../ui/button'
import { Suspense } from 'react'
import { Outlet, useSearchParams } from 'react-router-dom'
import { Eye, PenLine } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import MessagesHubNav from '../inbox/MessagesHubNav'
import SidebarCustomizeDialog from '../inbox/SidebarCustomizeDialog'
import { SidebarEditorProvider, useSidebarEditor } from '../../context/SidebarEditorContext'
import { SidebarPrefsProvider } from '../../context/SidebarPrefsContext'
import { SplitPane, SplitRow } from '../ui/SplitRow'
import { HubMainSkeleton } from '../ui/skeleton'

/**
 * Communication hub layout: customizable inner rail (Today, All
 * communication, pinned teams, Settings), thread list and conversation on
 * the right. New conversation lives on the main rail only.
 */
function MessagesHubFrame() {
  const { t } = useTranslation(['nav', 'communication'])
  const { openEditor } = useSidebarEditor()
  const [searchParams] = useSearchParams()
  const canvasOpen = Boolean((searchParams.get('canvas') || '').trim())

  return (
    <>
      <SplitRow
        storageKey="bokito.split.messagesHub"
        minFlex={480}
        resetHint={t('split.resetHint', { ns: 'communication' })}
        className="h-full min-h-0"
      >
        {canvasOpen ? null : (
        <SplitPane
          id="nav"
          defaultWidth={232}
          minWidth={176}
          maxWidth={380}
          label={t('split.nav', { ns: 'communication' })}
          className="hidden md:flex"
        >
          <aside className="flex h-full min-h-0 w-full flex-col bg-bg px-2 pb-2 pt-2.5">
            <div className="flex shrink-0 items-center gap-0.5 pb-1.5">
              <span className="min-w-0 flex-1 truncate px-2 text-sm font-medium text-text-heading">
                {t('tabs.communication.title')}
              </span>
              <Button variant="ghost" size="iconSm"
                type="button"
                onClick={() => openEditor()}
                className="shrink-0 text-text-muted"
                aria-label={t('support.customize.title')}
                data-testid="customize-sidebar"
              >
                <span className="relative inline-flex h-3.5 w-3.5 items-center justify-center" aria-hidden>
                  <Eye size={14} />
                  <PenLine
                    size={14}
                    className="absolute -bottom-0.5 -right-0.5 rounded-sm bg-bg"
                  />
                </span>
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <MessagesHubNav />
            </div>
          </aside>
        </SplitPane>
        )}
        <SplitPane id="main" defaultWidth={0} minWidth={0} maxWidth={0} flex>
          <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-hidden">
              <Suspense fallback={<HubMainSkeleton />}>
                <Outlet />
              </Suspense>
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
