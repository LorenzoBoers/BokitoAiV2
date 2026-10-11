import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import {
  deleteAgentRule,
  listAgentRules,
  type AgentRule,
  type AgentRulesRow,
} from '../../lib/agent-rules-api'
import { humanizeLabel } from '../../lib/labels'

const MODE_BADGE: Record<AgentRule['mode'], 'success' | 'warning' | 'error'> = {
  autonomous: 'success',
  assisted: 'warning',
  manual: 'error',
}

/**
 * Govern, Policy: the per-agent verdicts operators gave on action cards
 * (always / always ask / never for one tool), with a way to undo them.
 */
export function AgentActionRulesCard({ isAdmin }: { isAdmin: boolean }) {
  const { t } = useTranslation('govern')
  const [rows, setRows] = useState<AgentRulesRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    listAgentRules()
      .then((data) => {
        if (!cancelled) setRows(data)
      })
      .catch((err) => toast.error(formatApiErrorMessage(err, t('agentActionRules.loadError'))))
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [t])

  async function remove(agentId: string, rule: AgentRule) {
    setBusyId(rule.id)
    try {
      const next = await deleteAgentRule(agentId, rule.id)
      setRows((prev) =>
        prev
          .map((row) => (row.agentId === agentId ? { ...row, rules: next.rules } : row))
          .filter((row) => row.rules.length > 0),
      )
      toast.success(t('agentActionRules.removed'))
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('agentActionRules.removeError')))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Card data-testid="agent-action-rules">
      <CardHeader>
        <CardTitle>{t('agentActionRules.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-text-muted">{t('agentActionRules.intro')}</p>
        {loaded && rows.length === 0 ? (
          <p className="text-sm text-text-muted">{t('agentActionRules.empty')}</p>
        ) : null}
        {rows.map((row) => (
          <section key={row.agentId} className="space-y-1.5">
            <Link
              to={`/agents/${row.agentId}`}
              className="text-xs font-semibold text-text-heading hover:underline"
            >
              {row.agentName}
            </Link>
            {row.rules.map((rule) => {
              const canRemove = rule.mode === 'autonomous' || isAdmin
              return (
                <div
                  key={rule.id}
                  className="flex items-center gap-3 rounded-lg border border-border/60 px-3 py-2"
                  data-testid="agent-action-rule"
                >
                  <Badge variant={MODE_BADGE[rule.mode]} size="sm" className="shrink-0">
                    {t(`agentActionRules.mode.${rule.mode}`)}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-text-primary">{rule.text}</p>
                    <p className="text-2xs text-text-muted">
                      {rule.kind === 'hard' && rule.tool
                        ? humanizeLabel(rule.tool)
                        : rule.kind === 'hard'
                          ? rule.category
                          : t('agentActionRules.judgement')}
                      {' · '}
                      {t('agentActionRules.counts', { uses: rule.uses })}
                    </p>
                  </div>
                  {canRemove ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 shrink-0 p-0 text-text-muted"
                      aria-label={t('agentActionRules.remove')}
                      disabled={busyId === rule.id}
                      onClick={() => void remove(row.agentId, rule)}
                    >
                      <Trash2 size={13} />
                    </Button>
                  ) : null}
                </div>
              )
            })}
          </section>
        ))}
      </CardContent>
    </Card>
  )
}

export default AgentActionRulesCard
