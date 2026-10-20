/**
 * Collapsed thread row for a subagent: who, what, status. Expanding loads the
 * result and step log from the server.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, Workflow } from 'lucide-react'
import { appRoutes } from '../../api/routes'
import { useAuth } from '../../context/AuthContext'
import { apiGet } from '../../lib/api'
import { Badge, type BadgeTone } from '../ui/badge'
import { Button } from '../ui/button'
import { InsetPanel } from '../ui/inset-panel'
import ChatText from './ChatText'

type SubagentMeta = {
  run_id: string
  agent_name?: string
  description?: string
  status?: string
  stop_reason?: string
  result_preview?: string
}

type SubagentDetail = SubagentMeta & {
  result: string
  events: { type: string; message: string }[]
}

const TONES: Record<string, BadgeTone> = {
  queued: 'neutral',
  running: 'info',
  completed: 'success',
  failed: 'error',
  cancelled: 'warning',
}

export function SubagentRow({ threadId, meta }: { threadId: string; meta: SubagentMeta }) {
  const { t } = useTranslation('communication')
  const { token } = useAuth()
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState<SubagentDetail | null>(null)
  const [failed, setFailed] = useState(false)
  const status = meta.status || 'running'

  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (!next || !token) return
    try {
      setDetail(await apiGet<SubagentDetail>(appRoutes.signals.threadSubagent(threadId, meta.run_id), token))
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }

  return (
    <div className="my-1 flex flex-col items-center" data-testid="subagent-row">
      <Button type="button" variant="ghost" size="sm" onClick={() => void toggle()} aria-expanded={open}>
        {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
        <Workflow size={14} className="mx-1.5" aria-hidden />
        <span className="truncate text-xs text-text-muted">
          {t('subagent.line', {
            agent: meta.agent_name || t('subagent.agentFallback'),
            description: meta.description || '',
          })}
        </span>
        <Badge variant={TONES[status] ?? 'neutral'} className="ml-2">
          {t(`subagent.status.${status}`, { defaultValue: status })}
        </Badge>
      </Button>
      {open ? (
        <InsetPanel className="mt-1 w-full max-w-2xl space-y-2 text-sm">
          {failed ? <p className="text-text-muted">{t('subagent.failed')}</p> : null}
          {!failed && !detail ? <p className="text-text-muted">{t('subagent.loading')}</p> : null}
          {detail ? (
            <>
              {detail.result ? <ChatText content={detail.result} /> : <p className="text-text-muted">{t('subagent.noResult')}</p>}
              {detail.events.length ? (
                <ul className="space-y-0.5 text-xs text-text-muted">
                  {detail.events.map((event, index) => (
                    <li key={`${event.type}-${index}`} className="truncate">
                      {event.message || event.type}
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : null}
        </InsetPanel>
      ) : null}
    </div>
  )
}
