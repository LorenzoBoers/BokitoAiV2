import { Moon, Sun } from 'lucide-react'
import { useTheme } from '../../context/ThemeContext'

export default function ThemeModeToggle({ compact = false }: { compact?: boolean }) {
  const { isDark, toggleMode } = useTheme()

  if (compact) {
    return (
      <button
        type="button"
        onClick={toggleMode}
        title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-bg-hover/60 hover:text-text-primary"
      >
        {isDark ? <Moon size={14} /> : <Sun size={14} />}
      </button>
    )
  }

  return (
    <div className="flex items-center gap-1 rounded-lg border border-border/50 bg-bg-elevated/50 p-0.5">
      <button
        type="button"
        onClick={() => (isDark ? undefined : toggleMode())}
        className={`flex h-6 flex-1 items-center justify-center gap-1.5 rounded-md text-[11px] font-medium transition-colors ${
          isDark ? 'bg-bg-hover text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'
        }`}
        aria-pressed={isDark}
      >
        <Moon size={11} />
        Dark
      </button>
      <button
        type="button"
        onClick={() => (isDark ? toggleMode() : undefined)}
        className={`flex h-6 flex-1 items-center justify-center gap-1.5 rounded-md text-[11px] font-medium transition-colors ${
          !isDark ? 'bg-bg-hover text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'
        }`}
        aria-pressed={!isDark}
      >
        <Sun size={11} />
        Light
      </button>
    </div>
  )
}
