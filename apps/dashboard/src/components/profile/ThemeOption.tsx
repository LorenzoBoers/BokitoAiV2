import type { ReactNode } from 'react'

export type ThemeVariant = 'light' | 'dark' | 'system'

interface ThemeTokens {
  chrome: string       // outermost window bg
  sidebar: string      // left nav
  content: string      // main content area
  card: string         // card / row bg
  accent: string       // purple accent bar
  muted: string        // muted lines
  border: string
}

const T: Record<'light' | 'dark', ThemeTokens> = {
  light: {
    chrome:  '#eceef0',
    sidebar: '#f4f5f7',
    content: '#ffffff',
    card:    '#f0f1f3',
    accent:  '#635bff',
    muted:   '#d0d2d8',
    border:  '#dde0e6',
  },
  dark: {
    chrome:  '#0d0d10',
    sidebar: '#141418',
    content: '#1a1a22',
    card:    '#22222c',
    accent:  '#635bff',
    muted:   '#2e2e3a',
    border:  '#242430',
  },
}

function AppFrame({ tokens }: { tokens: ThemeTokens }) {
  return (
    <div
      className="flex h-full w-full overflow-hidden rounded-md"
      style={{ background: tokens.chrome, border: `1px solid ${tokens.border}` }}
    >
      {/* Sidebar */}
      <div className="flex w-[30%] flex-col gap-1.5 p-2" style={{ background: tokens.sidebar }}>
        <div className="h-2 w-8 rounded-full" style={{ background: tokens.accent }} />
        <div className="h-1.5 w-10 rounded-full" style={{ background: tokens.muted }} />
        <div className="h-1.5 w-7 rounded-full" style={{ background: tokens.muted }} />
        <div className="h-1.5 w-9 rounded-full" style={{ background: tokens.muted }} />
      </div>
      {/* Content */}
      <div className="flex flex-1 flex-col gap-1.5 p-2" style={{ background: tokens.content }}>
        <div className="h-2 w-12 rounded-full" style={{ background: tokens.muted }} />
        <div className="h-5 rounded-md" style={{ background: tokens.card }} />
        <div className="h-5 rounded-md" style={{ background: tokens.card }} />
        <div className="h-5 rounded-md" style={{ background: tokens.card }} />
      </div>
    </div>
  )
}

export function ThemeOption({ label, icon, active, onClick, variant }: {
  label: string
  icon: ReactNode
  active: boolean
  onClick: () => void
  variant: ThemeVariant
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex-1 rounded-lg border p-2.5 transition-all ${
        active
          ? 'border-accent ring-1 ring-accent/40'
          : 'border-border/60 hover:border-border'
      }`}
    >
      <div className="h-[88px] overflow-hidden rounded-lg">
        {variant === 'system' ? (
          <div className="flex h-full">
            <div className="w-1/2 overflow-hidden" style={{ clipPath: 'inset(0)' }}>
              <div className="h-full w-[200%]">
                <AppFrame tokens={T.light} />
              </div>
            </div>
            <div className="w-px shrink-0 bg-border" />
            <div className="w-1/2 overflow-hidden" style={{ clipPath: 'inset(0)' }}>
              <div className="relative h-full w-[200%]" style={{ marginLeft: '-100%' }}>
                <AppFrame tokens={T.dark} />
              </div>
            </div>
          </div>
        ) : (
          <AppFrame tokens={T[variant]} />
        )}
      </div>
      <span className="mt-2 flex items-center justify-center gap-1.5 text-xs font-medium text-text-secondary">
        {icon}{label}
      </span>
    </button>
  )
}
