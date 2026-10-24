import { AudioLines, Download } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../context/AuthContext'
import { useAgents } from '../../hooks/useAgents'
import type { InboxMessage } from '../../lib/inbox-api'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog'
import { THREAD_GUTTER } from './ThreadMeta'

type CallLine = { role?: string; text?: string }
type CallGroup = { mine: boolean; name: string; texts: string[] }

/** Consecutive lines from one person share a single name. */
export function groupCallLines(lines: CallLine[], you: string, agentName: string): CallGroup[] {
  const groups: CallGroup[] = []
  for (const line of lines) {
    const text = (line.text || '').trim()
    if (!text) continue
    const mine = line.role === 'user'
    const last = groups[groups.length - 1]
    if (last && last.mine === mine) last.texts.push(text)
    else groups.push({ mine, name: mine ? you : agentName, texts: [text] })
  }
  return groups
}

function downloadTranscript(filename: string, body: string) {
  const blob = new Blob([`\uFEFF${body}`], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
type CallLog = {
  started_at?: string
  duration_seconds?: number
  lines?: CallLine[]
}

function formatCallDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = total % 60
  const clock = `${minutes}:${String(rest).padStart(2, '0')}`
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}` : clock
}

/** One finished call in the thread: a quiet row, transcript on request. */
export function CallRecord({ message }: { message: InboxMessage }) {
  const { t, i18n } = useTranslation('communication')
  const { user } = useAuth()
  const { agents } = useAgents()
  const [open, setOpen] = useState(false)
  const agentId = typeof message.payload?.agent_id === 'string' ? message.payload.agent_id : ''
  const agentName = agents.find((row) => row.id === agentId)?.name || t('agentCall.agent')
  const you = user?.name?.trim() || t('agentCall.you')
  const log = (message.payload?.call_log ?? {}) as CallLog
  const lines = Array.isArray(log.lines) ? log.lines : []
  const groups = groupCallLines(lines, you, agentName)
  const duration =
    typeof log.duration_seconds === 'number' ? formatCallDuration(log.duration_seconds) : ''
  const ended = duration ? t('agentCall.recordEnded', { duration }) : t('agentCall.recordEndedPlain')
  const startedRaw = log.started_at || message.createdAt || ''
  const started = startedRaw ? new Date(startedRaw) : null
  const when =
    started && !Number.isNaN(started.getTime())
      ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(started)
      : ''

  return (
    <div className="flex items-start gap-2">
      <span className={THREAD_GUTTER} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
          <AudioLines size={16} className="shrink-0 text-text-muted" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-text-primary">{t('agentCall.recordTitle')}</p>
            <p className="text-xs text-text-muted">{ended}</p>
          </div>
          <Button
            variant="ghost"
            size="xs"
            className="shrink-0"
            onClick={() => setOpen(true)}
          >
            {t('agentCall.viewTranscript')}
          </Button>
        </div>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[80vh] max-w-lg flex-col gap-0 overflow-hidden p-0">
          <div className="border-b border-border px-4 py-3 pr-24">
            <DialogTitle className="text-sm font-medium text-text-heading">
              {t('agentCall.recordTitle')}
            </DialogTitle>
            <p className="mt-0.5 text-xs text-text-muted">{when ? `${when} · ${ended}` : ended}</p>
          </div>
          {groups.length ? (
            <Button
              variant="ghost"
              size="iconSm"
              className="absolute right-12 top-3 text-text-muted"
              aria-label={t('agentCall.exportTranscript')}
              title={t('agentCall.exportTranscript')}
              onClick={() => {
                const heading = t('agentCall.recordTitle')
                const meta = when ? `${when} · ${ended}` : ended
                const body = [
                  heading,
                  meta,
                  '',
                  ...groups.map((group) => `${group.name}\n${group.texts.join('\n')}`),
                ].join('\n')
                const stamp =
                  started && !Number.isNaN(started.getTime())
                    ? started.toISOString().slice(0, 16).replace(/[:T]/g, '-')
                    : 'call'
                downloadTranscript(`call-${stamp}.txt`, body)
              }}
            >
              <Download size={14} aria-hidden />
            </Button>
          ) : null}
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {groups.length ? (
              groups.map((group, index) => (
                <div
                  key={`${index}-${group.texts[0]?.slice(0, 12)}`}
                  className={cn(
                    'flex max-w-[85%] flex-col gap-1',
                    group.mine ? 'ml-auto items-end text-right' : 'mr-auto items-start text-left',
                  )}
                >
                  <span className="text-xs text-text-muted">{group.name}</span>
                  {group.texts.map((text, lineIndex) => (
                    <p
                      key={`${index}-${lineIndex}`}
                      className={cn(
                        'text-sm leading-relaxed',
                        group.mine ? 'text-text-primary' : 'text-text-secondary',
                      )}
                    >
                      {text}
                    </p>
                  ))}
                </div>
              ))
            ) : (
              <p className="text-sm text-text-muted">{t('agentCall.transcriptEmpty')}</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
