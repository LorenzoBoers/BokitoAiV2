import { Spinner } from '../ui/spinner'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Hash } from 'lucide-react'
import { type ChatTarget, type NavRow } from '../../lib/signals-api'
import { useCommunicationNav } from '../../hooks/useCommunicationNav'
import { agentFunctionLabel } from '../../lib/workforce-nav-agents'
import { lastInboxPath } from '../../lib/inbox-prefs'
import { agentProfileAccentColor, resolveAgentAvatarColor } from '../../lib/agent-avatar'
import { ChoiceSelect } from '../ui/ChoiceSelect'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import { type ChannelAccountRow } from '../../lib/channel-accounts-api'
import { type CategoryRow } from '../../lib/tickets-api'
import { useSpeechDictation, appendSpeechChunk } from '../../hooks/useSpeechDictation'
import { DictationMicButton } from '../inbox/DictationMicButton'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'

type Intent = 'contact' | 'agent' | 'teammate' | 'whatsapp' | 'ticket' | 'note' | 'transcript' | 'channel'

const NO_PROJECT = '__none__'

/** Pinned folder rows as `Parent / Child` options; virtual group children are skipped. */
function flattenNavFolders(rows: NavRow[], prefix: string[] = []): { id: string; path: string }[] {
  return rows.flatMap((row) => {
    if (row.virtual) return []
    const chain = [...prefix, row.name]
    return [{ id: row.id, path: chain.join(' / ') }, ...flattenNavFolders(row.children ?? [], chain)]
  })
}




export function TicketStart({
  categories,
  tagId,
  projectId,
  subject,
  note,
  fields,
  sending,
  error,
  onTag,
  onProject,
  onSubject,
  onNote,
  onField,
  onSubmit,
}: {
  categories: CategoryRow[]
  tagId: string
  projectId: string
  subject: string
  note: string
  fields: Record<string, string>
  sending: boolean
  error: string | null
  onTag: (id: string) => void
  onProject: (id: string) => void
  onSubject: (value: string) => void
  onNote: (value: string) => void
  onField: (key: string, value: string) => void
  onSubmit: () => void
}) {
  const { t } = useTranslation('communication')
  const { nav } = useCommunicationNav()
  const category = categories.find((row) => row.id === tagId) ?? null
  const folders = useMemo(() => flattenNavFolders(nav.projects), [nav.projects])
  const intake = category?.intake_fields ?? []
  const missingRequired = intake.some((field) => field.required && !(fields[field.key] || '').trim())
  const ready = Boolean(category && subject.trim() && !missingRequired)

  if (categories.length === 0) {
    return (
      <div className="panel px-5 py-8 text-center">
        <Hash size={24} className="mx-auto text-text-muted" />
        <p className="mt-3 text-sm text-text-primary">{t('newConversation.noActionTags')}</p>
        <Link to="/flows" className="mt-3 inline-block text-xs font-medium text-accent hover:underline">
          {t('newConversation.openFlows')}
        </Link>
      </div>
    )
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (ready) onSubmit()
      }}
    >
      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-text-muted">{t('tags.actionTag')}</span>
        <ChoiceSelect
          aria-label={t('tags.actionTag')}
          placeholder={t('newConversation.chooseActionTag')}
          value={tagId}
          onValueChange={onTag}
          groups={[
            {
              items: categories.map((row) => ({
                value: row.id,
                label: row.name,
                kind: 'tag' as const,
                category: true,
              })),
            },
          ]}
        />
      </label>
      {folders.length > 0 ? (
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-text-muted">{t('tags.chooseProject')}</span>
          <ChoiceSelect
            aria-label={t('tags.chooseProject')}
            placeholder={t('tags.noProject')}
            value={projectId || NO_PROJECT}
            onValueChange={onProject}
            groups={[
              {
                items: [
                  { value: NO_PROJECT, label: t('tags.noProject'), kind: 'project' as const },
                  ...folders.map((folder) => ({
                    value: folder.id,
                    label: folder.path,
                    kind: 'project' as const,
                  })),
                ],
              },
            ]}
          />
        </label>
      ) : null}
      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-text-muted">{t('newConversation.subjectPlaceholder')}</span>
        <Input
          value={subject}
          onChange={(event) => onSubject(event.target.value)}
          placeholder={t('newConversation.ticketSubjectPlaceholder')}
        />
      </label>
      {intake.map((field) => (
        <label key={field.key} className="block space-y-1.5">
          <span className="text-xs font-medium text-text-muted">
            {field.name}
            {field.required ? ` · ${t('tags.intakeRequired')}` : ''}
          </span>
          <Input
            value={fields[field.key] ?? ''}
            onChange={(event) => onField(field.key, event.target.value)}
          />
        </label>
      ))}
      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-text-muted">{t('newConversation.ticketNote')}</span>
        <Textarea
          value={note}
          onChange={(event) => onNote(event.target.value)}
          placeholder={t('newConversation.ticketNotePlaceholder')}
          rows={4}
        />
      </label>
      {error ? <p className="text-xs text-status-error">{error}</p> : null}
      <p className="text-xs text-text-muted">{t('newConversation.ticketHint')}</p>
      <Button size="sm"
        type="submit"
        disabled={sending || !ready}
      >
        {sending ? <Spinner size="md" /> : t('newConversation.logTicket')}
      </Button>
    </form>
  )
}

export function CarouselCaption({
  item,
}: {
  item:
    | { kind: 'agent'; agent: ChatTarget }
    | { kind: 'member'; member: { name: string; email: string } }
    | { kind: 'note' }
    | { kind: 'transcript' }
    | { kind: 'email'; mailbox: { displayName: string; mailboxEmail: string } }
    | { kind: 'channel'; account: ChannelAccountRow }
}) {
  const { t } = useTranslation('communication')
  const { t: tNav } = useTranslation('nav')
  const address =
    item.kind === 'email' ? item.mailbox.mailboxEmail : item.kind === 'channel' ? item.account.address : ''
  const title =
    item.kind === 'agent'
      ? item.agent.name
      : item.kind === 'member'
        ? item.member.name || item.member.email
        : item.kind === 'note'
          ? t('newConversation.carouselNote')
          : item.kind === 'transcript'
            ? t('newConversation.carouselTranscript')
            : item.kind === 'email'
            ? item.mailbox.displayName || address
            : item.account.displayName || address
  const channelKind = item.kind === 'channel' ? item.account.channel : item.kind === 'email' ? 'email' : ''
  const kicker =
    channelKind === 'email'
      ? t('newConversation.mailFromLabel')
      : channelKind === 'whatsapp'
        ? t('newConversation.whatsappFromLabel')
        : channelKind
          ? t(`newConversation.channel.${channelKind}`, { defaultValue: channelKind })
          : t('newConversation.messageTo')
  const detail =
    item.kind === 'member'
      ? t('newConversation.teammate')
      : item.kind === 'note'
        ? t('newConversation.carouselNoteHint')
        : item.kind === 'transcript'
          ? t('newConversation.carouselTranscriptHint')
          : address && address.trim() !== title.trim()
          ? address
          : ''
  const detailText = item.kind === 'agent' ? agentFunctionLabel(item.agent, tNav) : detail
  return (
    <div className="mt-4 flex h-[5.625rem] w-full max-w-lg flex-col items-center px-6">
      <p className="text-xs leading-4 text-text-muted">{kicker}</p>
      <h1 className="mt-0.5 line-clamp-1 max-w-full text-xl font-semibold leading-7 tracking-tight text-text-heading">
        {title}
      </h1>
      <p
        className={cn(
          'mt-1 line-clamp-2 h-10 max-w-full text-sm font-medium leading-5',
          item.kind === 'agent' ? '' : 'break-all text-text-secondary',
        )}
        style={
          item.kind === 'agent'
            ? { color: agentProfileAccentColor(resolveAgentAvatarColor(item.agent.avatar_color)) }
            : undefined
        }
      >
        {detailText || '\u00a0'}
      </p>
    </div>
  )
}

export function NoteStart({
  mode,
  sending,
  error,
  initialNote = '',
  onSubmit,
}: {
  mode: 'note' | 'transcript'
  sending: boolean
  error: string | null
  initialNote?: string
  onSubmit: (subject: string, note: string) => void
}) {
  const { t } = useTranslation('communication')
  const [subject, setSubject] = useState('')
  const [note, setNote] = useState(initialNote)
  const [interim, setInterim] = useState('')
  const interimRef = useRef('')
  interimRef.current = interim
  const append = useCallback((chunk: string) => {
    setNote((prev) => appendSpeechChunk(prev, chunk))
    setInterim('')
  }, [])
  const dictation = useSpeechDictation({ onFinal: append, onInterim: setInterim })
  const shown = dictation.listening && interim.trim() ? (note ? `${note} ${interim}` : interim) : note
  const confirm = () => {
    const pending = interimRef.current.trim()
    dictation.stop()
    if (pending) append(pending)
    else setInterim('')
  }
  const recording = mode === 'transcript'
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault()
        const pending = dictation.listening ? interimRef.current.trim() : ''
        if (dictation.listening) dictation.stop()
        const text = (pending ? appendSpeechChunk(note, pending) : note).trim()
        onSubmit(subject, text)
      }}
    >
      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-text-muted">{t('newConversation.subjectPlaceholder')}</span>
        <Input
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          placeholder={recording ? t('newConversation.transcriptSubjectPlaceholder') : t('newConversation.noteSubjectPlaceholder')}
        />
      </label>
      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-text-muted">
          {recording ? t('newConversation.transcriptBody') : t('newConversation.ticketNote')}
        </span>
        <Textarea
          value={shown}
          readOnly={dictation.listening}
          onChange={(event) => {
            if (dictation.listening) return
            setNote(event.target.value)
          }}
          placeholder={
            dictation.listening
              ? t('composer.dictationListening')
              : recording
                ? t('newConversation.transcriptPlaceholder')
                : t('newConversation.notePlaceholder')
          }
          rows={8}
        />
      </label>
      {recording && dictation.supported ? (
        <div className="flex items-center gap-2">
          <DictationMicButton
            listening={dictation.listening}
            disabled={sending}
            onStart={() => dictation.start()}
            onConfirm={confirm}
          />
          <span className="text-xs text-text-muted">
            {dictation.listening ? t('newConversation.transcriptListening') : t('newConversation.transcriptMic')}
          </span>
        </div>
      ) : recording ? (
        <p className="text-xs text-text-muted">{t('newConversation.transcriptNoMic')}</p>
      ) : null}
      {error ? <p className="text-xs text-status-error">{error}</p> : null}
      <p className="text-xs text-text-muted">
        {recording ? t('newConversation.transcriptHint') : t('newConversation.noteHint')}
      </p>
      <Button size="sm"
        type="submit"
        disabled={sending || !shown.trim()}
      >
        {sending ? <Spinner size="md" /> : t('newConversation.saveNote')}
      </Button>
    </form>
  )
}

export function HomeShortcuts() {
  const { t } = useTranslation('communication')
  const links = [
    { to: lastInboxPath(), label: t('newConversation.pageCommunication') },
    { to: '/agenda', label: t('newConversation.pageAgenda') },
    { to: '/contacts', label: t('newConversation.pageContacts') },
  ]
  return (
    <div className="relative z-10 flex flex-col items-center gap-4 text-center">
      <p className="text-2xs text-text-muted">{t('newConversation.poweredBy')}</p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        {links.map((link) => (
          <Link
            key={link.label}
            to={link.to}
            className="text-xs text-text-muted transition-colors hover:text-text-primary"
          >
            {link.label}
          </Link>
        ))}
      </div>
    </div>
  )
}

