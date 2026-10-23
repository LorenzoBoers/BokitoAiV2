import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog'
import { useTranslation } from 'react-i18next'

const ROWS: Array<{ keys: string; labelKey: string }> = [
  { keys: 'J / K', labelKey: 'shortcuts.nextPrev' },
  { keys: '] / [', labelKey: 'shortcuts.jumpUnread' },
  { keys: 'E', labelKey: 'shortcuts.close' },
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
  { keys: '1–4', labelKey: 'shortcuts.quickFilters' },
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

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent hideClose aria-describedby={undefined} className="block max-w-sm rounded-lg p-4 sm:rounded-lg">
        <div className="mb-3 flex items-center justify-between gap-3">
          <DialogTitle className="text-sm font-semibold text-text-heading">{t('shortcuts.title')}</DialogTitle>
          <Button variant="ghost" size="xs" type="button" onClick={onClose}>
            {t('shortcuts.closeHelp')}
          </Button>
        </div>
        <ul className="space-y-1.5">
          {ROWS.map((row) => (
            <li key={row.keys} className="flex items-center justify-between gap-3 text-xs">
              <span className="text-text-secondary">{t(row.labelKey)}</span>
              <kbd className="shrink-0 rounded border border-border bg-bg-elevated px-1.5 py-0.5 font-mono text-xs text-text-heading">
                {row.keys}
              </kbd>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
