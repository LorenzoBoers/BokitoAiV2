import { Search, Moon, Sun } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { useTheme } from '../../context/ThemeContext'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import NotificationDropdown from '../notifications/NotificationDropdown'

export default function AppHeader() {
  const { pathname } = useLocation()
  const { isDark, toggleMode } = useTheme()

  const title =
    pathname === '/communication'
      ? 'Communicatie'
      : pathname === '/cloud-agent'
        ? 'Cloud agent'
        : pathname.startsWith('/settings/integrations')
          ? 'Marketplace'
        : pathname.startsWith('/settings/email') || pathname.startsWith('/settings/communication-email')
            ? 'Email'
          : pathname === '/analytics'
          ? 'Analytics'
          : pathname === '/datasources'
            ? 'Databronnen'
            : pathname.startsWith('/settings/company-config')
              ? 'Bedrijfsconfiguratie'
              : pathname === '/workforce'
                  ? 'Workforce'
                : pathname === '/'
                  ? 'Dashboard'
                  : pathname.startsWith('/settings')
                    ? 'Instellingen'
                    : 'Bokito'

  return (
    <header className="h-12 grid grid-cols-[1fr_minmax(220px,420px)_1fr] items-center gap-3 px-4 border-b border-border/70 bg-bg-surface/45 backdrop-blur-sm flex-shrink-0">
      <div className="flex items-center justify-start min-w-0">
        <h1 className="text-[15px] font-semibold text-text-heading truncate">
          {title}
        </h1>
      </div>

      <div className="flex justify-center w-full">
        <div className="relative w-full max-w-md">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <Input className="pl-8 text-xs" placeholder="Zoeken..." />
        </div>
      </div>

      <div className="flex items-center justify-end gap-1.5">
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleMode}
          aria-label={isDark ? 'Zet light mode aan' : 'Zet dark mode aan'}
          title={isDark ? 'Light mode' : 'Dark mode'}
        >
          {isDark ? <Sun size={16} /> : <Moon size={16} />}
        </Button>
        <NotificationDropdown />
      </div>
    </header>
  )
}
