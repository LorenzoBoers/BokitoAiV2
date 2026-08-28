import { Archive, ArchiveRestore, Check, Clock, Mail, MoreHorizontal, OctagonAlert, Pin, PinOff, UserRound, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
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
  onPin?: (nextPinned: boolean) => void
  onClear: () => void
  onSelectAll?: () => void
}

const BUTTON =
  'inline-flex h-6 items-center gap-1 rounded px-1.5 text-[11px] text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors disabled:opacity-40'

/** Action bar shown above the thread list while threads are selected. */
export default function BulkActionsBar({ count, busy, onAction, onPin, onClear, onSelectAll }: Props) {
  const { t } = useTranslation('communication')
  const { user } = useAuth()
  const { members } = useMembers()
  const myId =
    members.find((member) => member.email.toLowerCase() === (user?.email ?? '').toLowerCase())?.id ??
    user?.id ??
    null

  return (
    <div className="flex items-center gap-1 border-b border-border/60 bg-accent/5 px-2 py-1.5">
      <span className="mr-1 text-[11px] font-medium text-text-heading">
        {t('bulkActions.selected', { count })}
      </span>
      {onSelectAll ? (
        <button type="button" disabled={busy} className={BUTTON} onClick={onSelectAll}>
          {t('bulkActions.selectAll')}
        </button>
      ) : null}
      <button type="button" disabled={busy} className={BUTTON} onClick={() => onAction('read')}>
        <Check size={11} />
        {t('bulkActions.read')}
      </button>
      <button type="button" disabled={busy} className={BUTTON} onClick={() => onAction('close')}>
        <Archive size={11} />
        {t('bulkActions.close')}
      </button>
      {onPin ? (
        <button type="button" disabled={busy} className={BUTTON} onClick={() => onPin(true)}>
          <Pin size={11} />
          {t('bulkActions.pin')}
        </button>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" disabled={busy} aria-label={t('bulkActions.moreActions')} className={BUTTON}>
            <MoreHorizontal size={11} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44">
          <DropdownMenuItem className="gap-2 text-xs" onSelect={() => onAction('snooze')}>
            <Clock size={12} />
            {t('bulkActions.snoozeTomorrow')}
          </DropdownMenuItem>
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
          {onPin ? (
            <DropdownMenuItem className="gap-2 text-xs" onSelect={() => onPin(false)}>
              <PinOff size={12} />
              {t('bulkActions.unpin')}
            </DropdownMenuItem>
          ) : null}
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
          {myId ? (
            <DropdownMenuItem className="gap-2 text-xs font-medium" onSelect={() => onAction('assign', myId)}>
              <UserRound size={14} />
              {t('bulkActions.assignToMe')}
            </DropdownMenuItem>
          ) : null}
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
