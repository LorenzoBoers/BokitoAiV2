import { Moon, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../context/ThemeContext'

export default function ThemeModeToggle({ compact = false }: { compact?: boolean }) {
  const { isDark, toggleMode } = useTheme()
  const { t } = useTranslation('nav')

  if (compact) {
    return (
      <button
        type="button"
        onClick={toggleMode}
        title={isDark ? t('palette.switchToLight') : t('palette.switchToDark')}
        aria-label={isDark ? t('palette.switchToLight') : t('palette.switchToDark')}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-[color,background-color,transform] duration-200 hover:bg-bg-hover/60 hover:text-text-primary active:scale-95"
      >
        {isDark ? <Moon size={14} /> : <Sun size={14} />}
      </button>
    )
  }

  return (
    <div className="relative flex items-center rounded-lg border border-border/60 bg-bg-elevated/50 p-0.5">
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded-md bg-bg-surface shadow-sm transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          isDark ? 'translate-x-0' : 'translate-x-[calc(100%+2px)]'
        }`}
      />
      <button
        type="button"
        onClick={() => (isDark ? undefined : toggleMode())}
        className={`relative z-10 flex h-6 flex-1 items-center justify-center gap-1.5 rounded-md text-[11px] font-medium transition-colors duration-200 ${
          isDark ? 'text-text-primary' : 'text-text-muted hover:text-text-secondary'
        }`}
        aria-pressed={isDark}
      >
        <Moon size={11} />
        {t('theme.dark', { defaultValue: 'Dark' })}
      </button>
      <button
        type="button"
        onClick={() => (isDark ? toggleMode() : undefined)}
        className={`relative z-10 flex h-6 flex-1 items-center justify-center gap-1.5 rounded-md text-[11px] font-medium transition-colors duration-200 ${
          !isDark ? 'text-text-primary' : 'text-text-muted hover:text-text-secondary'
        }`}
        aria-pressed={!isDark}
      >
        <Sun size={11} />
        {t('theme.light', { defaultValue: 'Light' })}
      </button>
    </div>
  )
}
