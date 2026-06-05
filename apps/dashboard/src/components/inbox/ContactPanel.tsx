import { Calendar, ChevronRight, Clock, Hash, Inbox, Mail, Phone, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { cn } from '../../lib/utils'
import { getAvatarColor, getInitials } from '../../lib/avatar'
import { getDomainFaviconUrl } from '../../lib/domain-favicon'
import { useAuth } from '../../context/AuthContext'
import { useMailboxConnections } from '../../hooks/useMailboxConnections'
import { listInboxMembers, type InboxMember, type InboxThread } from '../../lib/inbox-api'

type Props = {
  thread: InboxThread | null
  onClose: () => void
}

const STATUS_LABELS: Record<InboxThread['status'], string> = {
  open: 'Open',
  pending: 'In behandeling',
  closed: 'Gesloten',
  spam: 'Spam',
}

const STATUS_DOT: Record<InboxThread['status'], string> = {
  open: 'bg-status-success',
  pending: 'bg-status-warning',
  closed: 'bg-text-muted',
  spam: 'bg-status-error',
}

const PRIORITY_LABELS: Record<InboxThread['priority'], string> = {
  normal: 'Normaal',
  high: 'Hoog',
  urgent: 'Urgent',
}

const PRIORITY_COLORS: Record<InboxThread['priority'], string> = {
  normal: 'text-text-secondary',
  high: 'text-status-warning',
  urgent: 'text-status-error',
}

const FULL_DATE_FORMATTER = new Intl.DateTimeFormat('nl-NL', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

function formatFullDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return FULL_DATE_FORMATTER.format(date)
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const diffMs = Date.now() - date.getTime()
  const minutes = Math.round(diffMs / 60000)
  if (minutes < 1) return 'zojuist'
  if (minutes < 60) return `${minutes}m geleden`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}u geleden`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d geleden`
  return FULL_DATE_FORMATTER.format(date)
}

function ContactAvatar({ name, email }: { name: string; email: string }) {
  const display = name && name.trim().length > 0 ? name : email
  const initials = getInitials(display || '?')
  const color = getAvatarColor(email || display)
  const faviconUrl = getDomainFaviconUrl(email, 128)
  const [faviconFailed, setFaviconFailed] = useState(false)

  useEffect(() => {
    setFaviconFailed(false)
  }, [email])

  if (faviconUrl && !faviconFailed) {
    return (
      <div className="relative">
        <div
          className="h-12 w-12 rounded-full flex items-center justify-center text-sm font-semibold shadow-sm"
          style={{ backgroundColor: color.bg, color: color.text }}
        >
          {initials}
        </div>
        <img
          src={faviconUrl}
          alt=""
          className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-sm bg-bg-surface ring-1 ring-border/60"
          onError={() => setFaviconFailed(true)}
        />
      </div>
    )
  }

  return (
    <div
      className="h-12 w-12 rounded-full flex items-center justify-center text-sm font-semibold shadow-sm"
      style={{ backgroundColor: color.bg, color: color.text }}
    >
      {initials}
    </div>
  )
}

function MetaRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <div className="mt-0.5 text-text-muted shrink-0">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wide text-text-muted">{label}</div>
        <div className="text-xs text-text-primary mt-0.5 break-words">{children}</div>
      </div>
    </div>
  )
}

function SectionHeading({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between mb-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">{title}</h3>
      {hint ? <span className="text-[10px] text-text-muted/70">{hint}</span> : null}
    </div>
  )
}

function PlaceholderItem({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-dashed border-border/50 px-2.5 py-2 text-xs text-text-muted">
      <span>{label}</span>
      <ChevronRight size={12} className="opacity-40" />
    </div>
  )
}

export default function ContactPanel({ thread, onClose }: Props) {
  const { token } = useAuth()
  const { connections } = useMailboxConnections()
  const [membersById, setMembersById] = useState<Record<number, InboxMember>>({})

  useEffect(() => {
    if (!token) return
    let cancelled = false
    listInboxMembers(token)
      .then((members) => {
        if (cancelled) return
        const map: Record<number, InboxMember> = {}
        for (const m of members) {
          map[m.id] = m
        }
        setMembersById(map)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [token])

  const channelLabel = useMemo(() => {
    if (!thread?.emailConnectionId) return null
    const conn = connections.find((c) => c.id === thread.emailConnectionId)
    if (!conn) return null
    return conn.displayName || conn.mailboxEmail
  }, [thread?.emailConnectionId, connections])

  const assigneeName = useMemo(() => {
    if (!thread?.assignedToUserId) return null
    return membersById[thread.assignedToUserId]?.name ?? null
  }, [thread?.assignedToUserId, membersById])

  if (!thread) return null

  const displayName =
    thread.contactName && thread.contactName.trim().length > 0
      ? thread.contactName
      : thread.contactEmail || 'Unknown contact'
  const showSecondaryEmail =
    !!thread.contactEmail && thread.contactEmail !== displayName

  return (
    <aside className="flex flex-col h-full min-h-0 w-72 shrink-0 border-l border-border/50 bg-bg-surface">
      <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 border-b border-border/50 shrink-0">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Contact</h2>
        <button
          type="button"
          onClick={onClose}
          className="text-text-muted hover:text-text-primary rounded-sm p-0.5 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/50"
          aria-label="Sluit contactpaneel"
          title="Sluiten"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="px-4 pt-4 pb-3 flex flex-col items-center text-center border-b border-border/40">
          <ContactAvatar name={displayName} email={thread.contactEmail} />
          <div className="mt-3 text-sm font-semibold text-text-heading break-words leading-tight">
            {displayName}
          </div>
          {showSecondaryEmail ? (
            <a
              href={`mailto:${thread.contactEmail}`}
              className="mt-1 text-xs text-text-secondary hover:text-accent break-all"
            >
              {thread.contactEmail}
            </a>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
            {thread.contactEmail ? (
              <a
                href={`mailto:${thread.contactEmail}`}
                className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-bg-surface-hover px-2 py-1 text-[11px] text-text-primary hover:border-accent/60 hover:text-accent"
              >
                <Mail size={11} />
                Mail
              </a>
            ) : null}
            {thread.contactPhone ? (
              <a
                href={`tel:${thread.contactPhone}`}
                className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-bg-surface-hover px-2 py-1 text-[11px] text-text-primary hover:border-accent/60 hover:text-accent"
              >
                <Phone size={11} />
                Bellen
              </a>
            ) : null}
          </div>
        </div>

        <div className="px-4 py-3 border-b border-border/40">
          <SectionHeading title="Contactgegevens" />
          <div className="divide-y divide-border/30">
            <MetaRow icon={<Mail size={13} />} label="E-mail">
              {thread.contactEmail ? (
                <a
                  href={`mailto:${thread.contactEmail}`}
                  className="text-text-primary hover:text-accent break-all"
                >
                  {thread.contactEmail}
                </a>
              ) : (
                <span className="text-text-muted">—</span>
              )}
            </MetaRow>
            <MetaRow icon={<Phone size={13} />} label="Telefoon">
              {thread.contactPhone ? (
                <a
                  href={`tel:${thread.contactPhone}`}
                  className="text-text-primary hover:text-accent"
                >
                  {thread.contactPhone}
                </a>
              ) : (
                <span className="text-text-muted">Niet bekend</span>
              )}
            </MetaRow>
          </div>
        </div>

        <div className="px-4 py-3 border-b border-border/40">
          <SectionHeading title="Thread" />
          <div className="divide-y divide-border/30">
            <MetaRow icon={<Hash size={13} />} label="Status">
              <span className="inline-flex items-center gap-1.5">
                <span className={cn('h-1.5 w-1.5 rounded-full', STATUS_DOT[thread.status])} />
                <span className="text-text-primary">{STATUS_LABELS[thread.status]}</span>
              </span>
            </MetaRow>
            <MetaRow icon={<Hash size={13} />} label="Prioriteit">
              <span className={cn('font-medium', PRIORITY_COLORS[thread.priority])}>
                {PRIORITY_LABELS[thread.priority]}
              </span>
            </MetaRow>
            <MetaRow icon={<Inbox size={13} />} label="Mailbox">
              {channelLabel ? (
                <span className="text-text-primary break-words">{channelLabel}</span>
              ) : (
                <span className="text-text-muted">—</span>
              )}
            </MetaRow>
            <MetaRow icon={<Calendar size={13} />} label="Aangemaakt">
              <span className="text-text-primary">{formatFullDate(thread.createdAt)}</span>
            </MetaRow>
            <MetaRow icon={<Clock size={13} />} label="Laatste bericht">
              <span className="text-text-primary">{formatRelative(thread.lastMessageAt)}</span>
            </MetaRow>
            {assigneeName ? (
              <MetaRow icon={<Hash size={13} />} label="Toegewezen aan">
                <span className="text-text-primary">{assigneeName}</span>
              </MetaRow>
            ) : null}
          </div>
        </div>

        <div className="px-4 py-3 border-b border-border/40">
          <SectionHeading title="Previous threads" hint="Coming soon" />
          <PlaceholderItem label="Nog geen eerdere conversaties" />
        </div>

        <div className="px-4 py-3">
          <SectionHeading title="Tasks" hint="Coming soon" />
          <PlaceholderItem label="No linked tasks" />
        </div>
      </div>
    </aside>
  )
}
