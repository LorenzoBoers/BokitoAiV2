import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Settings2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import MessagesHubNav from '../inbox/MessagesHubNav'
import SidebarCustomizeDialog from '../inbox/SidebarCustomizeDialog'
import { SidebarPrefsProvider } from '../../context/SidebarPrefsContext'

/**
 * Communication hub layout: customizable inner rail (New chat, Inbox,
 * Assistant, Channels, Agents, Settings), thread list and
 * conversation on the right.
 */
export default function MessagesHub() {
  const { t } = useTranslation('nav')
  const [customizeOpen, setCustomizeOpen] = useState(false)

  return (
    <SidebarPrefsProvider>
      <div className="flex h-full min-h-0">
        <aside className="hidden w-[232px] shrink-0 flex-col border-r border-border/40 bg-bg-sidebar/50 px-2.5 py-3 md:flex">
          <div className="flex items-center justify-between px-2.5 pb-2">
            <p className="text-[15px] font-semibold leading-none text-text-heading">
              {t('sectionTitle.inbox', { defaultValue: 'Communication' })}
            </p>
            <button
              type="button"
              onClick={() => setCustomizeOpen(true)}
              className="rounded-md p-1 text-text-muted transition-colors hover:bg-bg-hover/70 hover:text-text-primary"
              aria-label={t('support.customize.title', { defaultValue: 'Customize sidebar' })}
              data-testid="customize-sidebar"
            >
              <Settings2 size={14} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <MessagesHubNav />
          </div>
        </aside>
        <div className="min-w-0 flex-1 overflow-hidden">
          <Outlet />
        </div>
        <SidebarCustomizeDialog open={customizeOpen} onOpenChange={setCustomizeOpen} />
      </div>
    </SidebarPrefsProvider>
  )
}
