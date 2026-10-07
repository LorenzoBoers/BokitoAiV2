import {
  Archive,
  ArchiveRestore,
  Check,
  Mail,
  MoreHorizontal,
  OctagonAlert,
  Pin,
  PinOff,
  Trash2,
  UserRound,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import { useMembers } from '../../hooks/useMembers'
import { bulkActionsVisibility } from '../../lib/bulk-actions'
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
  /** Current Communication folder queue (closed, spam, open, …). */
  listQueue?: string | null
  /** Active list quick filter (all / unread / pinned). */
  quickFilter?: string | null
  onAction: (action: BulkThreadAction, assigneeId?: number) => void
  onPin?: (nextPinned: boolean) => void
  onClear: () => void
  onSelectAll?: () => void
}

const BUTTON =
  'inline-flex h-6 shrink-0 items-center gap-1 rounded px-1.5 text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors disabled:opacity-40'

/** Action bar shown above the thread list while threads are selected. */
export default function BulkActionsBar({
  count,
  busy,
  listQueue = null,
  quickFilter = 'all',
  onAction,
  onPin,
  onClear,
  onSelectAll,
}: Props) {
  const { t } = useTranslation('communication')
  const { user } = useAuth()
  const { members } = useMembers()
  const myId =
    members.find((member) => member.email.toLowerCase() === (user?.email ?? '').toLowerCase())?.id ??
    user?.id ??
    null
  const visibility = bulkActionsVisibility(listQueue, quickFilter)
  const pinInMain = Boolean(onPin && visibility.showPin)
  const unpinInMain = Boolean(onPin && !visibility.showPin && visibility.showUnpin)
  const unpinInMore = Boolean(onPin && visibility.showUnpin && visibility.showPin)
  const reopenInMore = visibility.showReopen && visibility.primary !== 'reopen' && visibility.primary !== 'not_spam'

  return (
    <div className="border-b border-border/60 bg-accent/5 px-2 py-1.5">
      <div className="flex min-w-0 items-center gap-1">
        <span className="min-w-0 truncate text-xs font-medium text-text-heading">
          {t('bulkActions.selected', { count })}
        </span>
        {onSelectAll ? (
          <button type="button" disabled={busy} className={BUTTON} onClick={onSelectAll}>
            {t('bulkActions.selectAll')}
          </button>
        ) : null}
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
      <div className="mt-1 flex flex-wrap items-center gap-0.5">
        {visibility.showRead ? (
          <button type="button" disabled={busy} className={BUTTON} onClick={() => onAction('read')}>
            <Check size={11} />
            {t('bulkActions.read')}
          </button>
        ) : null}
        {visibility.primary === 'close' && visibility.showClose ? (
          <button type="button" disabled={busy} className={BUTTON} onClick={() => onAction('close')}>
            <Archive size={11} />
            {t('bulkActions.close')}
          </button>
        ) : null}
        {visibility.primary === 'reopen' ? (
          <button type="button" disabled={busy} className={BUTTON} onClick={() => onAction('reopen')}>
            <ArchiveRestore size={11} />
            {t('bulkActions.reopen')}
          </button>
        ) : null}
        {visibility.primary === 'not_spam' ? (
          <button type="button" disabled={busy} className={BUTTON} onClick={() => onAction('reopen')}>
            <ArchiveRestore size={11} />
            {t('bulkActions.notSpam')}
          </button>
        ) : null}
        {pinInMain ? (
          <button type="button" disabled={busy} className={BUTTON} onClick={() => onPin?.(true)}>
            <Pin size={11} />
            {t('bulkActions.pin')}
          </button>
        ) : null}
        {unpinInMain ? (
          <button type="button" disabled={busy} className={BUTTON} onClick={() => onPin?.(false)}>
            <PinOff size={11} />
            {t('bulkActions.unpin')}
          </button>
        ) : null}
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
                  <UserAvatar name={m.name} email={m.email} avatarUrl={m.avatarUrl} size={18} presence={m.presence} />
                  {m.name}
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" disabled={busy} aria-label={t('bulkActions.moreActions')} className={BUTTON}>
              <MoreHorizontal size={11} />
              {t('bulkActions.moreActions')}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44">
            {visibility.showUnread ? (
              <DropdownMenuItem className="gap-2 text-xs" onSelect={() => onAction('unread')}>
                <Mail size={12} />
                {t('bulkActions.markUnread')}
              </DropdownMenuItem>
            ) : null}
            {reopenInMore ? (
              <DropdownMenuItem className="gap-2 text-xs" onSelect={() => onAction('reopen')}>
                <ArchiveRestore size={12} />
                {t('bulkActions.reopen')}
              </DropdownMenuItem>
            ) : null}
            {visibility.showSpam ? (
              <DropdownMenuItem className="gap-2 text-xs" onSelect={() => onAction('spam')}>
                <OctagonAlert size={12} />
                {t('bulkActions.markSpam')}
              </DropdownMenuItem>
            ) : null}
            {unpinInMore ? (
              <DropdownMenuItem className="gap-2 text-xs" onSelect={() => onPin?.(false)}>
                <PinOff size={12} />
                {t('bulkActions.unpin')}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              className="gap-2 text-xs text-status-error focus:text-status-error"
              onSelect={() => onAction('trash')}
            >
              <Trash2 size={12} />
              {t('bulkActions.trash')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
