import { Archive, ArchiveRestore, Check, Mail, MoreHorizontal, OctagonAlert, UserRound, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useMembers } from '../../hooks/useMembers'
import type { BulkThreadAction } from '../../lib/inbox-api'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { UserAvatar } from '../ui/UserAvatar'

type Props = {
  count: number
  busy: boolean
  onAction: (action: BulkThreadAction, assigneeId?: number) => void
  onClear: () => void
}

const BUTTON =
  'inline-flex h-6 items-center gap-1 rounded px-1.5 text-[11px] text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors disabled:opacity-40'

/** Action bar shown above the thread list while threads are selected. */
export default function BulkActionsBar({ count, busy, onAction, onClear }: Props) {
  const { t } = useTranslation('communication')
  const { members } = useMembers()
  return (
    <div className="flex items-center gap-1 border-b border-border/60 bg-accent/5 px-2 py-1.5">
      <span className="mr-1 text-[11px] font-medium text-text-heading">
        {t('bulkActions.selected', { count })}
      </span>
      <button type="button" disabled={busy} className={BUTTON} onClick={() => onAction('read')}>
        <Check size={11} />
        {t('bulkActions.read')}
      </button>
      <button type="button" disabled={busy} className={BUTTON} onClick={() => onAction('close')}>
        <Archive size={11} />
        {t('bulkActions.close')}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" disabled={busy} aria-label={t('bulkActions.moreActions')} className={BUTTON}>
            <MoreHorizontal size={11} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44">
          <DropdownMenuItem className="gap-2 text-xs" onSelect={() => onAction('unread')}>
            <Mail size={12} />
            {t('bulkActions.markUnread')}
          </DropdownMenuItem>
          <DropdownMenuItem className="gap-2 text-xs" onSelect={() => onAction('reopen')}>
            <ArchiveRestore size={12} />
            {t('bulkActions.reopen')}
          </DropdownMenuItem>
          <DropdownMenuItem className="gap-2 text-xs" onSelect={() => onAction('spam')}>
            <OctagonAlert size={12} />
            {t('bulkActions.markSpam')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" disabled={busy} className={BUTTON}>
            <UserRound size={11} />
            {t('bulkActions.assign')}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          {members.length === 0 ? (
            <DropdownMenuItem disabled className="text-xs">
              {t('bulkActions.noMembers')}
            </DropdownMenuItem>
          ) : (
            members.map((m) => (
              <DropdownMenuItem
                key={m.id}
                className="gap-2 text-xs"
                onSelect={() => onAction('assign', m.id)}
              >
                <UserAvatar name={m.name} email={m.email} avatarUrl={m.avatarUrl} size={18} />
                {m.name}
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        aria-label={t('bulkActions.clearSelection')}
        className={`${BUTTON} ml-auto`}
        onClick={onClear}
      >
        <X size={11} />
        {t('bulkActions.clear')}
      </button>
    </div>
  )
}
