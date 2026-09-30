import { ShieldQuestion } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { useResolveDecision } from '@/api/queries'
import type { Decision } from '@/api/types'
import { Badge, statusTone } from '@/components/ui'
import { dateTime } from '@/lib/format'

export function DecisionCard({ decision, compact }: { decision: Decision; compact?: boolean }) {
  const { t, i18n } = useTranslation()
  const resolve = useResolveDecision()
  const [note, setNote] = useState('')
  const open = decision.status === 'open'
  const options = decision.options.length
    ? decision.options
    : [
        { id: 'approve', label: t('decisions.approve') },
        { id: 'reject', label: t('decisions.reject') },
      ]

  async function choose(option: string) {
    try {
      await resolve.mutateAsync({ id: decision.id, option, note })
      toast.success(t('decisions.resolved'))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error'))
    }
  }

  return (
    <div className="rounded-xl border border-ai/40 bg-ai/5 p-3">
      <div className="flex items-start gap-2">
        <ShieldQuestion className="mt-0.5 h-4 w-4 shrink-0 text-ai-ink" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-text-heading">{decision.title}</span>
            <Badge tone={statusTone(decision.status)}>{t(`decisions.status.${decision.status}`)}</Badge>
            {decision.tool_call?.name && <span className="chip font-mono">{decision.tool_call.name}</span>}
          </div>
          {decision.summary && <p className="mt-1 whitespace-pre-wrap text-xs text-text-secondary">{decision.summary}</p>}
          {decision.tool_call?.args && !compact && (
            <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-bg-elevated p-2 text-2xs text-text-secondary">
              {JSON.stringify(decision.tool_call.args, null, 2)}
            </pre>
          )}
          <div className="mt-1 text-2xs text-text-muted">
            {decision.requested_by} · {dateTime(decision.created_at, i18n.language)}
          </div>
          {open ? (
            <div className="mt-3 space-y-2">
              {!compact && (
                <input
                  className="field"
                  placeholder={t('decisions.notePlaceholder')}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              )}
              <div className="flex flex-wrap gap-2">
                {options.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    disabled={resolve.isPending}
                    onClick={() => void choose(o.id)}
                    className={o.id === 'approve' || o.kind === 'primary' ? 'btn-primary' : 'btn-outline'}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mt-2 text-xs text-text-secondary">
              {t('decisions.chosen')}: <span className="font-medium">{decision.chosen_option}</span>
              {decision.resolution_note && <span className="text-text-muted"> · {decision.resolution_note}</span>}
              {decision.result?.error ? (
                <span className="ml-1 text-status-error">{String(decision.result.error)}</span>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
