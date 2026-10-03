import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../context/AuthContext'
import { useIsAdmin } from '../../hooks/useIsAdmin'
import {
  updateChannelAccess,
  type ChannelAccess,
  type ChannelAccessEntry,
  type ChannelAccessKind,
  type ChannelAccessLevel,
} from '../../lib/channel-accounts-api'
import { getTeamOverview, type TeamOverview } from '../../lib/teams-api'
import { Button } from '../ui/button'
import { AiAvatar } from '../ui/AiAvatar'
import { UserAvatar } from '../ui/UserAvatar'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'

type Choice = 'none' | ChannelAccessLevel

const key = (kind: ChannelAccessKind, id: string) => `${kind}:${id}`

/**
 * Who may see (view) or handle a channel: people, agents and teams.
 * Owners and admins always handle every channel.
 */
export default function ChannelAccessPicker({
  accountId,
  access,
  onChanged,
}: {
  accountId: string
  access: ChannelAccess
  onChanged?: (next: ChannelAccess) => void
}) {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const isAdmin = useIsAdmin()
  const [state, setState] = useState<ChannelAccess>(access)
  const [open, setOpen] = useState(false)

  useEffect(() => setState(access), [access])

  if (!isAdmin) return null

  const summary = state.isDefault
    ? t('channelAccess.default')
    : t('channelAccess.count', { count: state.entries.length })

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} title={t('channelAccess.hint')}>
        <ShieldCheck size={13} />
        {summary}
      </Button>
      {open && token ? (
        <AccessDialog
          token={token}
          accountId={accountId}
          access={state}
          onClose={() => setOpen(false)}
          onSaved={(next) => {
            setState(next)
            onChanged?.(next)
            setOpen(false)
          }}
        />
      ) : null}
    </>
  )
}

function AccessDialog({
  token,
  accountId,
  access,
  onClose,
  onSaved,
}: {
  token: string
  accountId: string
  access: ChannelAccess
  onClose: () => void
  onSaved: (next: ChannelAccess) => void
}) {
  const { t } = useTranslation('nav')
  const [overview, setOverview] = useState<TeamOverview | null>(null)
  const [choices, setChoices] = useState<Record<string, Choice>>(() => {
    const map: Record<string, Choice> = {}
    for (const e of access.entries) map[key(e.kind, e.id)] = e.level
    return map
  })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    getTeamOverview(token)
      .then(setOverview)
      .catch((err) => toast.error(formatApiErrorMessage(err, t('channelAccess.loadError'))))
  }, [token, t])

  const rows = useMemo(() => {
    if (!overview) return []
    const teamRows = overview.teams.map((team) => ({
      kind: 'team' as const,
      id: team.system ? team.kind : team.id,
      label: team.system ? t(`teamPage.system.${team.kind}`) : team.name,
      avatar: null as React.ReactNode,
    }))
    const peopleRows = overview.people.map((p) => ({
      kind: 'user' as const,
      id: p.uuid,
      label: p.name,
      avatar: <UserAvatar name={p.name} email={p.email} avatarUrl={p.avatar_url} size={20} presence={p.presence?.status} />,
    }))
    const agentRows = overview.agents.map((a) => ({
      kind: 'agent' as const,
      id: a.id,
      label: a.name,
      avatar: <AiAvatar name={a.name} seed={a.id} size={20} />,
    }))
    return [
      { title: t('channelAccess.teams'), items: teamRows },
      { title: t('channelAccess.people'), items: peopleRows },
      { title: t('channelAccess.agents'), items: agentRows },
    ]
  }, [overview, t])

  const save = async (entries: ChannelAccessEntry[] | null) => {
    setBusy(true)
    try {
      onSaved(await updateChannelAccess(token, accountId, entries))
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('channelAccess.saveError')))
    } finally {
      setBusy(false)
    }
  }

  const entries = (): ChannelAccessEntry[] =>
    Object.entries(choices)
      .filter(([, level]) => level !== 'none')
      .map(([k, level]) => {
        const [kind, ...rest] = k.split(':')
        return { kind: kind as ChannelAccessKind, id: rest.join(':'), level: level as ChannelAccessLevel }
      })

  return (
    <Dialog open onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('channelAccess.title')}</DialogTitle>
          <DialogDescription>{t('channelAccess.description')}</DialogDescription>
        </DialogHeader>
        {!overview ? (
          <div className="flex justify-center py-6">
            <Loader2 size={16} className="animate-spin text-text-muted" />
          </div>
        ) : (
          <div className="max-h-[50vh] space-y-3 overflow-y-auto pr-1">
            {rows.map((group) =>
              group.items.length ? (
                <div key={group.title} className="space-y-1">
                  <p className="text-xs font-medium text-text-heading">{group.title}</p>
                  {group.items.map((item) => {
                    const k = key(item.kind, item.id)
                    return (
                      <div key={k} className="flex items-center justify-between gap-2 rounded px-1.5 py-1">
                        <span className="flex min-w-0 items-center gap-2 text-sm">
                          {item.avatar}
                          <span className="truncate">{item.label}</span>
                        </span>
                        <Select
                          value={choices[k] ?? 'none'}
                          onValueChange={(v) => setChoices((prev) => ({ ...prev, [k]: v as Choice }))}
                        >
                          <SelectTrigger className="h-7 w-[130px] text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">{t('channelAccess.level.none')}</SelectItem>
                            <SelectItem value="view">{t('channelAccess.level.view')}</SelectItem>
                            <SelectItem value="handle">{t('channelAccess.level.handle')}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )
                  })}
                </div>
              ) : null,
            )}
            <p className="text-xs text-text-muted">{t('channelAccess.adminsNote')}</p>
          </div>
        )}
        <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void save(null)}>
            {t('channelAccess.reset')}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              {t('teamPage.cancel')}
            </Button>
            <Button size="sm" disabled={busy || !overview} onClick={() => void save(entries())}>
              {t('teamPage.save')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
