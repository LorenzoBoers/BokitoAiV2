import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Eye, Loader2, Users } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../context/AuthContext'
import { useIsAdmin } from '../../hooks/useIsAdmin'
import { useMembers } from '../../hooks/useMembers'
import {
  updateChannelAccountVisibility,
  type ChannelAccountVisibility,
  type ChannelVisibilityMode,
} from '../../lib/channel-accounts-api'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'

/**
 * Who can see this channel account in the inbox. Owners and admins always
 * see everything; the ACL restricts members only.
 */
export default function ChannelVisibilityPicker({
  accountId,
  visibility,
  onChanged,
}: {
  accountId: string
  visibility: ChannelAccountVisibility
  onChanged?: (next: ChannelAccountVisibility) => void
}) {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const isAdmin = useIsAdmin()
  const { members } = useMembers()
  const [state, setState] = useState<ChannelAccountVisibility>(visibility)
  const [busy, setBusy] = useState(false)

  if (!isAdmin) return null

  const save = async (mode: ChannelVisibilityMode, userIds: string[]) => {
    if (!token) return
    setBusy(true)
    try {
      await updateChannelAccountVisibility(token, accountId, mode, userIds)
      const next: ChannelAccountVisibility = {
        mode,
        userIds: mode === 'selected' ? userIds : [],
      }
      setState(next)
      onChanged?.(next)
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('channelVisibility.saveError')))
    } finally {
      setBusy(false)
    }
  }

  const toggleUser = (uuid: string) => {
    const next = state.userIds.includes(uuid)
      ? state.userIds.filter((u) => u !== uuid)
      : [...state.userIds, uuid]
    void save('selected', next)
  }

  const label =
    state.mode === 'everyone'
      ? t('channelVisibility.everyone')
      : t('channelVisibility.selectedCount', { count: state.userIds.length })

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={busy}
          title={t('channelVisibility.hint')}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border/60 bg-bg-elevated px-2 text-xs text-text-secondary transition-colors hover:bg-bg-hover focus:outline-none focus:ring-1 focus:ring-border-focus disabled:opacity-40"
        >
          {busy ? (
            <Loader2 size={12} className="animate-spin" />
          ) : state.mode === 'everyone' ? (
            <Eye size={12} />
          ) : (
            <Users size={12} />
          )}
          {label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>{t('channelVisibility.title')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={state.mode}
          onValueChange={(value) => {
            if (value === 'everyone') void save('everyone', [])
            else void save('selected', state.userIds)
          }}
        >
          <DropdownMenuRadioItem value="everyone">
            {t('channelVisibility.everyone')}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="selected">
            {t('channelVisibility.selected')}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        {state.mode === 'selected' ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t('channelVisibility.membersLabel')}</DropdownMenuLabel>
            {members
              .filter((member) => member.uuid)
              .map((member) => (
                <DropdownMenuCheckboxItem
                  key={member.uuid}
                  checked={state.userIds.includes(member.uuid)}
                  onCheckedChange={() => toggleUser(member.uuid)}
                  onSelect={(event) => event.preventDefault()}
                >
                  <span className="truncate">{member.name}</span>
                </DropdownMenuCheckboxItem>
              ))}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
