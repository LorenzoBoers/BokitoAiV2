import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../context/AuthContext'
import { useAgents } from '../../hooks/useAgents'
import { useMembers } from '../../hooks/useMembers'
import { useTeams } from '../../hooks/useTeams'
import { agentPresenceOf, seedAgentPresence, useAgentPresence } from '../../hooks/useAgentPresence'
import { Avatar } from '../ui/avatar'
import { TeamFacepile } from '../ui/TeamFacepile'
import { Button } from '../ui/button'
import { Textarea } from '../ui/textarea'
import { cn } from '../../lib/utils'
import { preferLiveAgentAvatar } from '../../lib/agent-avatar'
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
  const { agents } = useAgents()
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
      team.name === 'All' || team.system ? tn('teamPage.system.all') : team.name,
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
  const blocked = t('threadChrome.noChannelAccess' /* design-system-ignore: melding of fout, geen lege lijst */)
  const currentAgent = useMemo(() => {
    if (owner?.kind !== 'agent' || !owner.agentId) return null
    const fromCandidates = candidates?.agents.find((a) => a.id === owner.agentId)
    const stamped = fromCandidates
      ? {
          id: fromCandidates.id,
          name: fromCandidates.name,
          avatarKind: fromCandidates.avatarKind,
          avatarIcon: fromCandidates.avatarIcon,
          avatarColor: fromCandidates.avatarColor,
          avatarShape: fromCandidates.avatarShape,
          avatarImageUrl: fromCandidates.avatarImageUrl,
        }
      : { id: owner.agentId, name: owner.agentId }
    return preferLiveAgentAvatar(
      agents.find((a) => a.id === owner.agentId),
      stamped,
    )
  }, [owner, candidates, agents])

  const triggerMark = currentMember ? (
    <Avatar
      kind="person"
      name={currentMember.name}
      email={currentMember.email}
      imageUrl={currentMember.avatarUrl}
      size={20}
      presence={currentMember.presence}
      decorative
    />
  ) : owner?.kind === 'team' && currentTeam ? (
    <Avatar
      kind="team"
      team={{
        ...currentTeam,
        name: currentTeam.system ? tn(`teamPage.system.${currentTeam.kind}`) : currentTeam.name,
      }}
      size={20}
      decorative
      presence={currentTeam.presence?.status}
    />
  ) : owner?.kind === 'agent' && owner.agentId ? (
    <Avatar
      kind="agent"
      agent={currentAgent}
      fallbackName={owner.agentId}
      size={20}
      decorative
      mode="static"
      activity={currentAgentActivity}
    />
  ) : (
    <UserRound size={14} />
  )

  return (
    <>
      <DropdownMenu onOpenChange={load}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="iconSm"
                type="button"
                id="inbox-assignee-trigger"
                disabled={disabled}
                aria-label={tooltip}
                className={cn('shrink-0 text-text-muted data-[state=open]:bg-bg-hover data-[state=open]:text-text-primary', owned && 'text-accent')}
              >
                {triggerMark}
              </Button>
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
                (!currentTeam || currentTeam.system) &&
                'bg-bg-hover',
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
                  className={cn('gap-2 text-xs', currentAssigneeId === p.id && 'bg-bg-hover')}
                >
                  <Avatar kind="person" decorative={false} name={p.name} email={p.email} imageUrl={p.avatarUrl} size={20} presence={p.presence} />
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
                  className={cn('gap-2 text-xs', owner?.kind === 'agent' && owner.agentId === a.id && 'bg-bg-hover')}
                >
                  <Avatar
                    kind="agent"
                    agent={preferLiveAgentAvatar(
                      agents.find((row) => row.id === a.id),
                      a,
                    )}
                    fallbackName={a.name}
                    size={18}
                    decorative
                    mode="static"
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
                  className={cn('gap-2 text-xs', owner?.kind === 'team' && owner.teamId === team.id && 'bg-bg-hover')}
                >
                  <TeamFacepile
                    team={{
                      id: team.id,
                      name: teamLabel(team),
                      members: team.members,
                      avatar_kind: team.avatarKind,
                      avatar_icon: team.avatarIcon,
                      avatar_color: team.avatarColor,
                      avatar_image_url: team.avatarImageUrl,
                    }}
                    size={20}
                    linkAgents={false}
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
                className={cn('gap-2 text-xs', currentAssigneeId === m.id && 'bg-bg-hover')}
              >
                <Avatar kind="person" decorative={false} name={m.name} email={m.email} imageUrl={m.avatarUrl} size={20} presence={m.presence} />
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
