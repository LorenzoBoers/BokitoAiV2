import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Pause, Play, Plus, Trash2, Zap } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import {
  createInboxRule,
  deleteInboxRule,
  listInboxRules,
  updateInboxRule,
  type InboxRule,
} from '../../lib/signals-api'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { Input } from '../ui/input'
import { KnowledgeTile, LearnedChip } from '../knowledge/KnowledgeMark'
import { inboxPath } from '../../lib/messages-paths'

const ACTION_KEYS: Record<InboxRule['action'], string> = {
  auto_close: 'automationRules.actionClose',
  auto_task: 'automationRules.actionTask',
  mute_ai: 'automationRules.actionSkip',
}

const MATCH_KEYS: Record<InboxRule['matchType'], string> = {
  sender: 'automationRules.matchSender',
  domain: 'automationRules.matchDomain',
  list_id: 'automationRules.matchListId',
}

function statusBadge(rule: InboxRule, t: (key: string, opts?: Record<string, number>) => string) {
  if (rule.status === 'active') return <Badge variant="success">{t('automationRules.active')}</Badge>
  if (rule.status === 'paused') return <Badge variant="secondary">{t('automationRules.paused')}</Badge>
  return (
    <Badge variant="secondary">
      {t('automationRules.learning', {
        current: Math.min(rule.observations, rule.promotionThreshold),
        threshold: rule.promotionThreshold,
      })}
    </Badge>
  )
}

/**
 * Settings card: per-sender inbox automation. Rules are learned from repeated
 * operator choices on "No reply needed" cards or created manually here.
 */
export default function AutomationRulesManager() {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const [rules, setRules] = useState<InboxRule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [matchType, setMatchType] = useState<InboxRule['matchType']>('sender')
  const [matchValue, setMatchValue] = useState('')
  const [action, setAction] = useState<InboxRule['action']>('auto_close')
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    void listInboxRules(token)
      .then((data) => {
        if (!cancelled) setRules(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : t('automationRules.loadFailed'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [token, t])

  const handleCreate = useCallback(async () => {
    if (!token || !matchValue.trim()) return
    setSaving(true)
    setError(null)
    try {
      const created = await createInboxRule(token, {
        matchType,
        matchValue: matchValue.trim(),
        action,
      })
      if (created) {
        setRules((prev) => [created, ...prev.filter((r) => r.id !== created.id)])
      }
      setCreating(false)
      setMatchValue('')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('automationRules.createFailed'))
    } finally {
      setSaving(false)
    }
  }, [token, matchType, matchValue, action, t])

  const handleToggle = useCallback(
    async (rule: InboxRule) => {
      if (!token) return
      setBusyId(rule.id)
      setError(null)
      try {
        const next = rule.status === 'active' ? 'paused' : 'active'
        const updated = await updateInboxRule(token, rule.id, { status: next })
        if (updated) setRules((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
      } catch (err) {
        setError(err instanceof Error ? err.message : t('automationRules.updateFailed'))
      } finally {
        setBusyId(null)
      }
    },
    [token, t],
  )

  const handleDelete = useCallback(
    async (rule: InboxRule) => {
      if (!token) return
      if (!window.confirm(t('automationRules.deleteConfirm', { value: rule.matchValue }))) return
      setBusyId(rule.id)
      setError(null)
      try {
        await deleteInboxRule(token, rule.id)
        setRules((prev) => prev.filter((r) => r.id !== rule.id))
      } catch (err) {
        setError(err instanceof Error ? err.message : t('automationRules.deleteFailed'))
      } finally {
        setBusyId(null)
      }
    },
    [token],
  )

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div className="flex min-w-0 items-start gap-3">
          <KnowledgeTile className="mt-0.5" />
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-medium text-text-heading">
              {t('automationRules.title')}
              <LearnedChip label={t('automationRules.selfLearning')} />
            </p>
            <p className="text-xs text-text-secondary">
              {t('automationRules.description')}
            </p>
          </div>
        </div>
        {!creating ? (
          <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
            <Plus size={13} />
            {t('automationRules.newRule')}
          </Button>
        ) : null}
      </div>
      <div className="divide-y divide-border/40">
        {error ? <p className="px-4 py-2 text-xs text-status-error">{error}</p> : null}
        {loading ? (
          <p className="px-4 py-4 text-xs text-text-muted">{t('automationRules.loading')}</p>
        ) : rules.length === 0 && !creating ? (
          <div className="px-4 py-4">
            <p className="text-xs text-text-muted">
              {t('automationRules.empty')}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
                <Plus size={13} />
                {t('automationRules.newRule')}
              </Button>
              <Link
                to={inboxPath('open')}
                className="text-[12px] font-medium text-accent hover:underline"
              >
                {t('automationRules.openCommunication')}
              </Link>
            </div>
          </div>
        ) : null}
        {rules.map((rule) => (
          <div key={rule.id} className="flex items-center gap-3 px-4 py-2.5">
            <Zap
              size={14}
              className={rule.status === 'active' ? 'shrink-0 text-accent' : 'shrink-0 text-text-muted'}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-text-heading">
                {rule.matchValue}
              </p>
              <p className="text-xs text-text-secondary">
                {t(MATCH_KEYS[rule.matchType])} &middot; {t(ACTION_KEYS[rule.action])}
                {rule.hitCount > 0
                  ? ` \u00b7 ${t('automationRules.applied', { count: rule.hitCount })}`
                  : ''}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {statusBadge(rule, t)}
              <Button
                size="sm"
                variant="ghost"
                aria-label={rule.status === 'active' ? t('automationRules.pauseRule') : t('automationRules.activateRule')}
                title={rule.status === 'active' ? t('automationRules.pause') : t('automationRules.activate')}
                disabled={busyId === rule.id}
                onClick={() => void handleToggle(rule)}
              >
                {rule.status === 'active' ? <Pause size={13} /> : <Play size={13} />}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={t('automationRules.deleteRule')}
                disabled={busyId === rule.id}
                onClick={() => void handleDelete(rule)}
              >
                <Trash2 size={13} />
              </Button>
            </div>
          </div>
        ))}
        {creating ? (
          <div className="space-y-2 px-4 py-3">
            <div className="flex flex-wrap gap-2">
              <select
                value={matchType}
                onChange={(e) => setMatchType(e.target.value as InboxRule['matchType'])}
                aria-label={t('automationRules.matchSender')}
                className="h-8 rounded-md border border-border bg-bg-surface px-2 text-sm text-text-primary focus:border-accent/50 focus:outline-none"
              >
                <option value="sender">{t('automationRules.matchSenderAddr')}</option>
                <option value="domain">{t('automationRules.matchDomainOpt')}</option>
                <option value="list_id">{t('automationRules.matchListIdOpt')}</option>
              </select>
              <Input
                value={matchValue}
                onChange={(e) => setMatchValue(e.target.value)}
                placeholder={
                  matchType === 'sender'
                    ? 'noreply@example.com'
                    : matchType === 'domain'
                      ? 'example.com'
                      : 'news.example.com'
                }
                className="h-8 max-w-64 text-sm"
              />
              <select
                value={action}
                onChange={(e) => setAction(e.target.value as InboxRule['action'])}
                aria-label={t('automationRules.actionClose')}
                className="h-8 rounded-md border border-border bg-bg-surface px-2 text-sm text-text-primary focus:border-accent/50 focus:outline-none"
              >
                <option value="auto_close">{t('automationRules.actionCloseThread')}</option>
                <option value="auto_task">{t('automationRules.actionCreateTask')}</option>
                <option value="mute_ai">{t('automationRules.actionSkipAi')}</option>
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="secondary" disabled={saving} onClick={() => setCreating(false)}>
                {t('automationRules.cancel')}
              </Button>
              <Button size="sm" disabled={saving || !matchValue.trim()} onClick={() => void handleCreate()}>
                {saving ? t('automationRules.saving') : t('automationRules.create')}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </Card>
  )
}
