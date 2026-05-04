import { } from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { cn } from '../../lib/utils';

interface ThemeToggleProps {
  className?: string;
  showLabel?: boolean;
  variant?: 'button' | 'dropdown' | 'segmented';
}

export function ThemeToggle({ className, showLabel = false, variant = 'button' }: ThemeToggleProps) {
  const { mode, setMode, toggleMode, isDark } = useTheme();

  if (variant === 'dropdown') {
    return (
      <div className={cn('relative', className)}>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as 'light' | 'dark' | 'system')}
          className="appearance-none bg-bg-surface border border-border rounded-md px-3 py-2 pr-8 text-sm text-text-primary focus:outline-none focus:border-border-focus transition-colors"
        >
          <option value="light">Licht</option>
          <option value="dark">Donker</option>
          <option value="system">Systeem</option>
        </select>
        <div className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
          <svg className="h-4 w-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>
    );
  }

  if (variant === 'segmented') {
    return (
      <div className={cn('flex bg-bg-muted rounded-lg p-1', className)}>
        <button
          onClick={() => setMode('light')}
          className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
            mode === 'light'
              ? 'bg-bg-surface text-text-primary shadow-sm'
              : 'text-text-secondary hover:text-text-primary'
          )}
        >
          <Sun className="w-4 h-4" />
          {showLabel && 'Licht'}
        </button>
        <button
          onClick={() => setMode('dark')}
          className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
            mode === 'dark'
              ? 'bg-bg-surface text-text-primary shadow-sm'
              : 'text-text-secondary hover:text-text-primary'
          )}
        >
          <Moon className="w-4 h-4" />
          {showLabel && 'Donker'}
        </button>
        <button
          onClick={() => setMode('system')}
          className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
            mode === 'system'
              ? 'bg-bg-surface text-text-primary shadow-sm'
              : 'text-text-secondary hover:text-text-primary'
          )}
        >
          <Monitor className="w-4 h-4" />
          {showLabel && 'Systeem'}
        </button>
      </div>
    );
  }

  // Default button variant
  return (
    <button
      onClick={toggleMode}
      className={cn(
        'flex items-center gap-2 p-2 rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-muted transition-colors',
        className
      )}
      title={`Schakel naar ${isDark ? 'licht' : 'donker'} thema`}
    >
      {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
      {showLabel && (
        <span className="text-sm">
          {isDark ? 'Licht' : 'Donker'}
        </span>
      )}
    </button>
  );
}

export function ThemeStatus() {
  const { mode, resolvedTheme } = useTheme();
  
  return (
    <div className="flex items-center gap-2 text-xs text-text-muted">
      <div className="flex items-center gap-1">
        {resolvedTheme === 'dark' ? <Moon className="w-3 h-3" /> : <Sun className="w-3 h-3" />}
        <span>{resolvedTheme === 'dark' ? 'Donker' : 'Licht'}</span>
      </div>
      {mode === 'system' && (
        <span className="text-text-muted/60">(systeem)</span>
      )}
    </div>
  );
}