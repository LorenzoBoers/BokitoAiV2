import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../context/AuthContext'
import { useMembers } from '../../hooks/useMembers'
import { useTeams } from '../../hooks/useTeams'
import { agentPresenceOf, seedAgentPresence, useAgentPresence } from '../../hooks/useAgentPresence'
import { AiAvatar } from '../ui/AiAvatar'
import { TeamAvatar } from '../ui/TeamAvatar'
import { UserAvatar } from '../ui/UserAvatar'
import { Button } from '../ui/button'
import { Textarea } from '../ui/textarea'
import { cn } from '../../lib/utils'
import { toAiAvatarProps } from '../../lib/agent-avatar'
import { toTeamAvatarProps } from '../../lib/team-avatar'
import type { AssigneeInput, ThreadOwner } from '../../lib/inbox-api'
import { listSignalAssignees, type AssigneeCandidates } from '../../lib/signals-api'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

type Props = {
  threadId: string
  owner?: ThreadOwner
  currentAssigneeId: number | null
  onAssign: (assignee: AssigneeInput) => Promise<void> | void
  disabled?: boolean
}

type Handover = { kind: 'agent' | 'team'; id: string; name: string }

/** One picker for people, agents and teams. Agents and teams take an optional handover message. */
export default function AssigneeSelector({ threadId, owner, currentAssigneeId, onAssign, disabled }: Props) {
  const { t } = useTranslation('communication')
  const { t: tn } = useTranslation('nav')
  const { token, user } = useAuth()
  const { members } = useMembers()
  const { teams } = useTeams()
  const [candidates, setCandidates] = useState<AssigneeCandidates | null>(null)
  const [handover, setHandover] = useState<Handover | null>(null)
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)

  const myId =
    members.find((member) => member.email.toLowerCase() === (user?.email ?? '').toLowerCase())?.id ??
    user?.id ??
    null
  const assignedToMe = myId != null && myId !== 0 && currentAssigneeId === myId
  const currentMember = useMemo(
    () => members.find((m) => m.id === currentAssigneeId) ?? null,
    [members, currentAssigneeId],
  )
  const currentTeam = useMemo(() => {
    if (owner?.kind !== 'team' || !owner.teamId) return null
    return teams.find((team) => team.id === owner.teamId) ?? null
  }, [owner, teams])

  const teamLabel = useCallback(
    (team: AssigneeCandidates['teams'][number]) =>
      team.kind === 'custom' ? team.name : tn(`teamPage.system.${team.kind}`),
    [tn],
  )

  const load = useCallback(
    (open: boolean) => {
      if (!open || !token) return
      listSignalAssignees(token, threadId)
        .then((rows) => {
          setCandidates(rows)
          seedAgentPresence(rows.agents.map((a) => ({ id: a.id, status: a.status })))
        })
        .catch(() => toast.error(t('threadChrome.assigneesLoadError')))
    },
    [token, threadId, t],
  )

  const currentAgentActivity = useAgentPresence(owner?.kind === 'agent' ? owner.agentId : null)

  const confirmHandover = async () => {
    if (!handover) return
    setSaving(true)
    try {
      await onAssign({ kind: handover.kind, id: handover.id, message: message.trim() || undefined })
      setHandover(null)
      setMessage('')
    } finally {
      setSaving(false)
    }
  }

  const tooltip = currentMember
    ? t('threadChrome.assignedTo', { name: currentMember.name })
    : owner?.kind === 'team' && currentTeam
      ? t('threadChrome.assignedTo', {
          name: currentTeam.system ? tn(`teamPage.system.${currentTeam.kind}`) : currentTeam.name,
        })
      : owner?.kind === 'agent'
        ? t('threadChrome.assign')
        : t('threadChrome.assign')
  const owned = Boolean(currentMember) || owner?.kind === 'agent' || owner?.kind === 'team'
  const blocked = t('threadChrome.noChannelAccess')
  const currentAgent =
    owner?.kind === 'agent' && owner.agentId
      ? candidates?.agents.find((a) => a.id === owner.agentId) ?? null
      : null

  const triggerMark = currentMember ? (
    <UserAvatar
      name={currentMember.name}
      email={currentMember.email}
      avatarUrl={currentMember.avatarUrl}
      size={18}
      presence={currentMember.presence}
      decorative
    />
  ) : owner?.kind === 'team' && currentTeam ? (
    <TeamAvatar
      {...toTeamAvatarProps(currentTeam)}
      size={18}
      decorative
      presence={currentTeam.presence?.status}
    />
  ) : owner?.kind === 'agent' && owner.agentId ? (
    <AiAvatar
      {...toAiAvatarProps({
        id: owner.agentId,
        name: currentAgent?.name ?? owner.agentId,
        avatar_kind: currentAgent?.avatarKind,
        avatar_icon: currentAgent?.avatarIcon,
        avatar_image_url: currentAgent?.avatarImageUrl,
      })}
      size={18}
      decorative
      activity={currentAgentActivity}
    />
  ) : (
    <UserRound size={14} strokeWidth={owned ? 2.25 : 1.75} />
  )

  return (
    <>
      <DropdownMenu onOpenChange={load}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                id="inbox-assignee-trigger"
                disabled={disabled}
                aria-label={tooltip}
                className={cn(
                  'inline-flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors',
                  'hover:bg-bg-hover hover:text-text-primary',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/50',
                  'disabled:pointer-events-none disabled:opacity-40',
                  'data-[state=open]:bg-bg-hover data-[state=open]:text-text-primary',
                  owned && 'text-accent',
                )}
              >
                {triggerMark}
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">{tooltip}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="max-h-[22rem] min-w-[14rem] overflow-y-auto">
          <DropdownMenuLabel className="normal-case tracking-normal font-medium text-text-secondary">
            {t('threadChrome.assign')}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {myId != null && !assignedToMe ? (
            <DropdownMenuItem
              data-testid="thread-assign-to-me"
              onSelect={() => void onAssign({ kind: 'user', id: myId })}
              className="text-xs font-medium"
            >
              {t('threadChrome.assignToMe')}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            data-testid="thread-unassign"
            onSelect={() => void onAssign({ kind: 'team', id: null })}
            className={cn(
              'text-xs',
              owner?.kind === 'team' &&
                currentAssigneeId == null &&
                (!currentTeam || currentTeam.kind === 'people') &&
                'bg-bg-hover/80',
            )}
          >
            {t('threadChrome.unassigned')}
          </DropdownMenuItem>
          {candidates ? (
            <>
              <DropdownMenuLabel className="pt-2 text-2xs text-text-muted">{t('threadChrome.assignPeople')}</DropdownMenuLabel>
              {candidates.people.map((p) => (
                <DropdownMenuItem
                  key={p.id}
                  disabled={!p.canHandle}
                  onSelect={() => void onAssign({ kind: 'user', id: p.id })}
                  className={cn('gap-2 text-xs', currentAssigneeId === p.id && 'bg-bg-hover/80')}
                >
                  <UserAvatar name={p.name} email={p.email} avatarUrl={p.avatarUrl} size={18} presence={p.presence} />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  {!p.canHandle ? <span className="shrink-0 text-2xs text-text-muted">{blocked}</span> : null}
                </DropdownMenuItem>
              ))}
              {candidates.agents.length > 0 ? (
                <DropdownMenuLabel className="pt-2 text-2xs text-text-muted">{t('threadChrome.assignAgents')}</DropdownMenuLabel>
              ) : null}
              {candidates.agents.map((a) => (
                <DropdownMenuItem
                  key={a.id}
                  disabled={!a.canHandle}
                  onSelect={() => setHandover({ kind: 'agent', id: a.id, name: a.name })}
                  className={cn('gap-2 text-xs', owner?.kind === 'agent' && owner.agentId === a.id && 'bg-bg-hover/80')}
                >
                  <AiAvatar
                    {...toAiAvatarProps({
                      id: a.id,
                      name: a.name,
                      avatar_kind: a.avatarKind,
                      avatar_icon: a.avatarIcon,
                      avatar_image_url: a.avatarImageUrl,
                    })}
                    size={18}
                    decorative
                    activity={agentPresenceOf(a.id)}
                  />
                  <span className="min-w-0 flex-1 truncate">{a.name}</span>
                  {!a.canHandle ? <span className="shrink-0 text-2xs text-text-muted">{blocked}</span> : null}
                </DropdownMenuItem>
              ))}
              <DropdownMenuLabel className="pt-2 text-2xs text-text-muted">{t('threadChrome.assignTeams')}</DropdownMenuLabel>
              {candidates.teams.map((team) => (
                <DropdownMenuItem
                  key={team.id}
                  onSelect={() => setHandover({ kind: 'team', id: team.id, name: teamLabel(team) })}
                  className={cn('gap-2 text-xs', owner?.kind === 'team' && owner.teamId === team.id && 'bg-bg-hover/80')}
                >
                  <TeamAvatar
                    {...toTeamAvatarProps({
                      id: team.id,
                      name: teamLabel(team),
                      avatar_kind: team.avatarKind,
                      avatar_icon: team.avatarIcon,
                      avatar_color: team.avatarColor,
                      avatar_image_url: team.avatarImageUrl,
                    })}
                    size={18}
                    decorative
                    presence={team.presence}
                  />
                  <span className="min-w-0 flex-1 truncate">{teamLabel(team)}</span>
                </DropdownMenuItem>
              ))}
            </>
          ) : (
            members.map((m) => (
              <DropdownMenuItem
                key={m.id}
                onSelect={() => void onAssign({ kind: 'user', id: m.id })}
                className={cn('gap-2 text-xs', currentAssigneeId === m.id && 'bg-bg-hover/80')}
              >
                <UserAvatar name={m.name} email={m.email} avatarUrl={m.avatarUrl} size={18} presence={m.presence} />
                {m.name}
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={handover !== null} onOpenChange={(open) => (open ? null : setHandover(null))}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('threadChrome.handoverTitle', { name: handover?.name ?? '' })}</DialogTitle>
            <DialogDescription>
              {handover?.kind === 'agent' ? t('threadChrome.handoverHintAgent') : t('threadChrome.handoverHintTeam')}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            autoFocus
            rows={3}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t('threadChrome.handoverPlaceholder')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void confirmHandover()
            }}
          />
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setHandover(null)}>
              {t('threadChrome.handoverCancel')}
            </Button>
            <Button size="sm" disabled={saving} onClick={() => void confirmHandover()}>
              {t('threadChrome.handoverConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
