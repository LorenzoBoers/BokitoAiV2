import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

const ROWS: Array<{ keys: string; labelKey: string }> = [
  { keys: 'J / K', labelKey: 'shortcuts.nextPrev' },
  { keys: '] / [', labelKey: 'shortcuts.jumpUnread' },
  { keys: 'E', labelKey: 'shortcuts.close' },
  { keys: 'H', labelKey: 'shortcuts.snooze' },
  { keys: 'Shift+H', labelKey: 'shortcuts.snoozeCustom' },
  { keys: 'U', labelKey: 'shortcuts.unread' },
  { keys: 'Shift+U', labelKey: 'shortcuts.markRead' },
  { keys: 'Cmd+A', labelKey: 'shortcuts.selectAll' },
  { keys: 'P', labelKey: 'shortcuts.pin' },
  { keys: 'A', labelKey: 'shortcuts.assign' },
  { keys: 'Shift+A', labelKey: 'shortcuts.assignPicker' },
  { keys: 'X', labelKey: 'shortcuts.select' },
  { keys: 'L', labelKey: 'shortcuts.copyLink' },
  { keys: '#', labelKey: 'shortcuts.copyId' },
  { keys: 'R', labelKey: 'shortcuts.reply' },
  { keys: 'C', labelKey: 'shortcuts.compose' },
  { keys: 'N', labelKey: 'shortcuts.newChat' },
  { keys: '1–5', labelKey: 'shortcuts.quickFilters' },
  { keys: '/', labelKey: 'shortcuts.search' },
  { keys: 'Cmd+K', labelKey: 'shortcuts.commandPalette' },
  { keys: 'Cmd+Enter', labelKey: 'shortcuts.send' },
  { keys: 'Enter', labelKey: 'shortcuts.sendChat' },
  { keys: '?', labelKey: 'shortcuts.thisHelp' },
  { keys: 'Esc', labelKey: 'shortcuts.escape' },
]

type Props = {
  open: boolean
  onClose: () => void
}

export default function InboxShortcutHelp({ open, onClose }: Props) {
  const { t } = useTranslation('communication')

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 px-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('shortcuts.title')}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-border/60 bg-bg-surface p-4 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-[13px] font-semibold text-text-heading">{t('shortcuts.title')}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-[11px] font-medium text-text-muted hover:bg-bg-hover hover:text-text-primary"
          >
            {t('shortcuts.closeHelp')}
          </button>
        </div>
        <ul className="space-y-1.5">
          {ROWS.map((row) => (
            <li key={row.keys} className="flex items-center justify-between gap-3 text-[12px]">
              <span className="text-text-secondary">{t(row.labelKey)}</span>
              <kbd className="shrink-0 rounded border border-border/70 bg-bg-elevated px-1.5 py-0.5 font-mono text-[11px] text-text-heading">
                {row.keys}
              </kbd>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
