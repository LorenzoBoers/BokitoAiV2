import { useEffect, useMemo, useState } from 'react'
import { Send } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { sendEmailMessage, type EmailMessage } from '../../lib/email-api'

type ComposeMode = 'reply' | 'forward' | 'note'

type ComposeAreaProps = {
  connectionId: number | null
  selectedMessage: EmailMessage | null
  externalDraft?: string | null
  onSent: () => void
}

export default function ComposeArea({ connectionId, selectedMessage, externalDraft, onSent }: ComposeAreaProps) {
  const { token } = useAuth()
  const [mode, setMode] = useState<ComposeMode>('reply')
  const [toAddresses, setToAddresses] = useState('')
  const [cc, setCc] = useState('')
  const [bcc, setBcc] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [showCcBcc, setShowCcBcc] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const subjectPrefix = useMemo(() => {
    if (!selectedMessage) return ''
    if (mode === 'forward') return 'Fwd: '
    if (mode === 'reply') return 'Re: '
    return ''
  }, [mode, selectedMessage])

  useEffect(() => {
    if (!selectedMessage) return
    setToAddresses(mode === 'reply' ? selectedMessage.fromAddress : '')
    setSubject(`${subjectPrefix}${selectedMessage.subject}`)
    setBody(mode === 'reply' ? `\n\n---\n${selectedMessage.bodyPreview}` : '')
    setError(null)
  }, [mode, selectedMessage, subjectPrefix])

  useEffect(() => {
    if (externalDraft && externalDraft.trim().length > 0) {
      setBody(externalDraft)
      setMode('reply')
    }
  }, [externalDraft])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      const inField = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA'
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        void handleSend()
      }
      if (!inField && event.key.toLowerCase() === 'r') {
        event.preventDefault()
        setMode('reply')
      }
      if (!inField && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        setMode('forward')
      }
      if (!inField && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        setMode('note')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  async function handleSend() {
    if (mode === 'note') return
    if (!token || !connectionId || !toAddresses.trim() || !subject.trim() || !body.trim()) return
    setSending(true)
    setError(null)
    try {
      await sendEmailMessage(token, {
        connectionId,
        toAddresses: toAddresses.trim(),
        cc: cc.trim() || undefined,
        bcc: bcc.trim() || undefined,
        subject: subject.trim(),
        bodyText: body.trim(),
        bodyHtml: body.trim(),
        inReplyTo: selectedMessage?.inReplyTo ?? undefined,
        threadId: selectedMessage?.threadId ?? undefined,
      })
      setBody('')
      onSent()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kon bericht niet verzenden.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="border-t border-border/70 bg-bg-surface/30 p-3 space-y-2">
      <div className="flex items-center gap-1">
        {[
          { id: 'reply', label: 'Antwoord' },
          { id: 'forward', label: 'Doorsturen' },
          { id: 'note', label: 'Interne notitie' },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setMode(item.id as ComposeMode)}
            className={`px-2 py-1 rounded text-[11px] border ${
              mode === item.id
                ? 'bg-accent/10 text-accent border-accent/25'
                : 'text-text-muted border-border hover:bg-bg-hover'
            }`}
          >
            {item.label}
          </button>
        ))}
        <button
          type="button"
          className="ml-auto text-[11px] text-text-muted hover:text-text-primary"
          onClick={() => setShowCcBcc((prev) => !prev)}
        >
          CC/BCC
        </button>
      </div>

      {mode !== 'note' ? (
        <>
          <input
            value={toAddresses}
            onChange={(event) => setToAddresses(event.target.value)}
            className="w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-xs outline-none"
            placeholder="Aan"
          />
          {showCcBcc ? (
            <div className="grid grid-cols-2 gap-2">
              <input
                value={cc}
                onChange={(event) => setCc(event.target.value)}
                className="w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-xs outline-none"
                placeholder="CC"
              />
              <input
                value={bcc}
                onChange={(event) => setBcc(event.target.value)}
                className="w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-xs outline-none"
                placeholder="BCC"
              />
            </div>
          ) : null}
          <input
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            className="w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-xs outline-none"
            placeholder="Onderwerp"
          />
        </>
      ) : null}

      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        className="w-full min-h-[96px] rounded-md border border-border bg-transparent px-2 py-2 text-xs outline-none resize-y"
        placeholder={mode === 'note' ? 'Interne notitie toevoegen...' : 'Typ je bericht...'}
      />

      {error ? <div className="text-xs text-status-error">{error}</div> : null}

      <div className="flex items-center justify-between">
        <div className="text-2xs text-text-muted">Sneltoets: Ctrl/Cmd + Enter om te verzenden</div>
        <button
          type="button"
          disabled={sending || mode === 'note'}
          onClick={() => void handleSend()}
          className="inline-flex items-center gap-1 rounded-md border border-accent/30 bg-accent/10 px-2.5 py-1.5 text-xs text-accent disabled:opacity-60"
        >
          <Send size={12} />
          {sending ? 'Verzenden...' : 'Verzenden'}
        </button>
      </div>
    </div>
  )
}
