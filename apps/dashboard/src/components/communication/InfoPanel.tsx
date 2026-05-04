import { CheckCircle2, CircleDot, ListTodo, MessageSquareText } from 'lucide-react'
import type { EmailMessage } from '../../lib/email-api'

type InfoPanelProps = {
  selectedMessage: EmailMessage | null
  messages: EmailMessage[]
}

export default function InfoPanel({ selectedMessage, messages }: InfoPanelProps) {
  const current = selectedMessage ?? messages[0] ?? null
  const previousMessages = current
    ? messages
        .filter((message) => message.id !== current.id && message.fromAddress === current.fromAddress)
        .slice(0, 4)
    : []

  const notes = current
    ? [
        current.labels?.length ? `Labels: ${current.labels.join(', ')}` : null,
        !current.isRead ? 'Dit bericht staat nog op ongelezen.' : 'Dit bericht is al gelezen.',
        current.conversationStatus ? `Status: ${current.conversationStatus}` : null,
      ].filter(Boolean)
    : []

  return (
    <div className="w-[276px] bg-bg-sidebar/40 border-l border-border/70 flex flex-col h-full flex-shrink-0">
      <div className="h-10 flex items-center px-3.5 border-b border-border/70 flex-shrink-0">
        <span className="text-[12px] font-semibold text-text-heading">Overzicht</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3.5 space-y-4">
        <section>
          <div className="section-label px-0">Contact info</div>
          {current ? (
            <div className="space-y-2.5 mt-1">
              <InfoRow label="Afzender" value={current.fromAddress} />
              <InfoRow label="E-mail" value={current.fromAddress ?? '-'} />
              <InfoRow label="Status" value={current.conversationStatus ?? '-'} />
              <InfoRow label="Laatste bericht" value={current.receivedAt ? new Date(current.receivedAt).toLocaleString() : '-'} />
            </div>
          ) : (
            <p className="mt-1 text-xs text-text-muted">Geen afzender geselecteerd.</p>
          )}
        </section>

        <section>
          <div className="section-label px-0">Notities</div>
          {notes.length > 0 ? (
            <div className="mt-1 space-y-1.5">
              {notes.map((note, index) => (
                <div key={index} className="text-xs text-text-secondary rounded-md border border-border/60 bg-bg-elevated/35 px-2.5 py-1.5">
                  {note}
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-xs text-text-muted">Nog geen notities voor deze afzender.</p>
          )}
        </section>

        {current?.aiSummary && (
          <section>
            <div className="section-label px-0">Bokito AI</div>
            <div className="mt-1 rounded-lg border border-accent/25 bg-accent/[0.06] p-2.5 space-y-2">
              <div className="flex items-start gap-2">
                <CheckCircle2 size={13} className="text-accent flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-text-primary leading-snug">{current.aiSummary}</p>
                </div>
              </div>
              {current.sentiment ? (
                <div className="flex items-start gap-2">
                  <CircleDot size={13} className="text-accent flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-text-primary leading-snug">Sentiment: {current.sentiment}</p>
                  </div>
                </div>
              ) : null}
              {current.assignedToUserId ? (
                <div className="flex items-start gap-2">
                  <ListTodo size={13} className="text-accent flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-text-primary leading-snug">Toegewezen aan user #{current.assignedToUserId}</p>
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        )}

        <section>
          <div className="section-label px-0">Eerdere berichten</div>
          {previousMessages.length > 0 ? (
            <div className="mt-1 space-y-1.5">
              {previousMessages.map((message) => (
                <div key={message.id} className="rounded-md border border-border/60 px-2.5 py-2 bg-bg-surface/35">
                  <div className="flex items-center gap-1.5 text-2xs text-text-muted mb-0.5">
                    <MessageSquareText size={11} />
                    <span>{message.receivedAt ? new Date(message.receivedAt).toLocaleString() : '-'}</span>
                  </div>
                  <div className="text-xs font-medium text-text-primary truncate">{message.subject || 'Geen onderwerp'}</div>
                  <div className="text-2xs text-text-muted truncate mt-0.5">{message.bodyPreview}</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-xs text-text-muted">Geen eerdere berichten van deze afzender.</p>
          )}
        </section>
      </div>
    </div>
  )
}

function InfoRow({
  label,
  value,
}: {
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-text-muted">{label}</span>
      <span className="text-text-primary font-medium">{value}</span>
    </div>
  )
}
