import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../context/AuthContext'
import { useIsAdmin } from '../../hooks/useIsAdmin'
import { getTeamOverview, type TeamOverview } from '../../lib/teams-api'
import { toAiAvatarProps } from '../../lib/agent-avatar'
import { toTeamAvatarProps } from '../../lib/team-avatar'
import { Button } from '../ui/button'
import { AiAvatar } from '../ui/AiAvatar'
import { TeamAvatar } from '../ui/TeamAvatar'
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

export type AccessKind = 'user' | 'agent' | 'team'

/** One grant. System teams use their kind as id: `people` or `agents`. */
export type AccessEntry<L extends string = string> = { kind: AccessKind; id: string; level: L }

export type AccessState<L extends string = string> = { entries: AccessEntry<L>[]; isDefault: boolean }

/** Copy for the object being shared; generic labels come from `access.*`. */
export type AccessCopy = { title: string; description: string; hint: string; adminsNote: string }

const key = (kind: AccessKind, id: string) => `${kind}:${id}`

/**
 * Who may reach an object (channel, connection): people, agents and teams at
 * ordered levels. Owners and admins always hold the highest level.
 */
export function AccessPicker<L extends string>({
  access,
  levels,
  copy,
  save,
  onChanged,
  canEdit,
}: {
  access: AccessState<L>
  levels: readonly L[]
  copy: AccessCopy
  save: (entries: AccessEntry<L>[] | null) => Promise<AccessState<L>>
  onChanged?: (next: AccessState<L>) => void
  /** Defaults to workspace admin. */
  canEdit?: boolean
}) {
  const { t } = useTranslation('nav')
  const isAdmin = useIsAdmin()
  const [state, setState] = useState<AccessState<L>>(access)
  const [open, setOpen] = useState(false)

  useEffect(() => setState(access), [access])

  if (!(canEdit ?? isAdmin)) return null

  const summary = state.isDefault
    ? t('access.default')
    : t('access.count', { count: state.entries.length })

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} title={copy.hint}>
        <ShieldCheck size={13} />
        {summary}
      </Button>
      {open ? (
        <AccessDialog
          access={state}
          levels={levels}
          copy={copy}
          save={save}
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

function AccessDialog<L extends string>({
  access,
  levels,
  copy,
  save,
  onClose,
  onSaved,
}: {
  access: AccessState<L>
  levels: readonly L[]
  copy: AccessCopy
  save: (entries: AccessEntry<L>[] | null) => Promise<AccessState<L>>
  onClose: () => void
  onSaved: (next: AccessState<L>) => void
}) {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const [overview, setOverview] = useState<TeamOverview | null>(null)
  const [choices, setChoices] = useState<Record<string, L | 'none'>>(() => {
    const map: Record<string, L | 'none'> = {}
    for (const e of access.entries) map[key(e.kind, e.id)] = e.level
    return map
  })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!token) return
    getTeamOverview(token)
      .then(setOverview)
      .catch((err) => toast.error(formatApiErrorMessage(err, t('access.loadError'))))
  }, [token, t])

  const groups = useMemo(() => {
    if (!overview) return []
    const teamRows = overview.teams.map((team) => ({
      kind: 'team' as const,
      id: team.system ? team.kind : team.id,
      label: team.system ? t(`teamPage.system.${team.kind}`) : team.name,
      avatar: <TeamAvatar {...toTeamAvatarProps(team)} size={20} />,
    }))
    const peopleRows = overview.people.map((p) => ({
      kind: 'user' as const,
      id: p.uuid,
      label: p.name,
      avatar: (
        <UserAvatar name={p.name} email={p.email} avatarUrl={p.avatar_url} size={20} presence={p.presence?.status} />
      ),
    }))
    const agentRows = overview.agents.map((a) => ({
      kind: 'agent' as const,
      id: a.id,
      label: a.name,
      avatar: <AiAvatar {...toAiAvatarProps(a)} size={20} />,
    }))
    return [
      { title: t('access.teams'), items: teamRows },
      { title: t('access.people'), items: peopleRows },
      { title: t('access.agents'), items: agentRows },
    ]
  }, [overview, t])

  const submit = async (entries: AccessEntry<L>[] | null) => {
    setBusy(true)
    try {
      onSaved(await save(entries))
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('access.saveError')))
    } finally {
      setBusy(false)
    }
  }

  const entries = (): AccessEntry<L>[] =>
    Object.entries(choices)
      .filter(([, level]) => level !== 'none')
      .map(([k, level]) => {
        const [kind, ...rest] = k.split(':')
        return { kind: kind as AccessKind, id: rest.join(':'), level: level as L }
      })

  return (
    <Dialog open onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        {!overview ? (
          <div className="flex justify-center py-6">
            <Loader2 size={16} className="animate-spin text-text-muted" />
          </div>
        ) : (
          <div className="max-h-[50vh] space-y-3 overflow-y-auto pr-1">
            {groups.map((group) =>
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
                          onValueChange={(v) => setChoices((prev) => ({ ...prev, [k]: v as L | 'none' }))}
                        >
                          <SelectTrigger className="h-7 w-[130px] text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">{t('access.level.none')}</SelectItem>
                            {levels.map((level) => (
                              <SelectItem key={level} value={level}>
                                {t(`access.level.${level}`)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )
                  })}
                </div>
              ) : null,
            )}
            <p className="text-xs text-text-muted">{copy.adminsNote}</p>
          </div>
        )}
        <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void submit(null)}>
            {t('access.reset')}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              {t('teamPage.cancel')}
            </Button>
            <Button size="sm" disabled={busy || !overview} onClick={() => void submit(entries())}>
              {t('teamPage.save')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
