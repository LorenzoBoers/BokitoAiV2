import { Sun, Moon, Monitor } from 'lucide-react'
import { useTheme } from '../../context/ThemeContext'
import { cn } from '../../lib/utils'
import { Tip } from './Tip'

interface ThemeToggleProps {
  className?: string;
  showLabel?: boolean;
  variant?: 'button' | 'segmented';
}

export function ThemeToggle({ className, showLabel = false, variant = 'button' }: ThemeToggleProps) {
  const { mode, setMode, toggleMode, isDark } = useTheme();

  if (variant === 'segmented') {
    return (
      <div className={cn('flex bg-bg-muted rounded-lg p-1', className)}>
        <button
          onClick={() => setMode('light')}
          className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
            mode === 'light'
              ? 'bg-bg-surface text-text-primary '
              : 'text-text-secondary hover:text-text-primary'
          )}
        >
          <Sun className="w-4 h-4" />
          {showLabel && 'Light'}
        </button>
        <button
          onClick={() => setMode('dark')}
          className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
            mode === 'dark'
              ? 'bg-bg-surface text-text-primary '
              : 'text-text-secondary hover:text-text-primary'
          )}
        >
          <Moon className="w-4 h-4" />
          {showLabel && 'Dark'}
        </button>
        <button
          onClick={() => setMode('system')}
          className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
            mode === 'system'
              ? 'bg-bg-surface text-text-primary '
              : 'text-text-secondary hover:text-text-primary'
          )}
        >
          <Monitor className="w-4 h-4" />
          {showLabel && 'System'}
        </button>
      </div>
    );
  }

  // Default button variant
  return (
    <Tip label={`Switch to ${isDark ? 'light' : 'dark'} theme`}>
      <button
        onClick={toggleMode}
        className={cn(
          'flex items-center gap-2 p-2 rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-muted transition-colors',
          className
        )}
      >
        {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        {showLabel && (
          <span className="text-sm">
            {isDark ? 'Light' : 'Dark'}
          </span>
        )}
      </button>
    </Tip>
  )
}

export function ThemeStatus() {
  const { mode, resolvedTheme } = useTheme();
  
  return (
    <div className="flex items-center gap-2 text-xs text-text-muted">
      <div className="flex items-center gap-1">
        {resolvedTheme === 'dark' ? <Moon className="w-3 h-3" /> : <Sun className="w-3 h-3" />}
        <span>{resolvedTheme === 'dark' ? 'Dark' : 'Light'}</span>
      </div>
      {mode === 'system' && (
        <span className="text-text-muted/60">(system)</span>
      )}
    </div>
  );
}
