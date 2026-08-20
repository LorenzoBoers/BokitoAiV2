import { useCallback, useEffect, useState } from 'react'
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

const ACTION_LABELS: Record<InboxRule['action'], string> = {
  auto_close: 'Auto-close',
  auto_task: 'Create task',
  mute_ai: 'Skip AI',
}

const MATCH_LABELS: Record<InboxRule['matchType'], string> = {
  sender: 'Sender',
  domain: 'Domain',
  list_id: 'Mailing list',
}

function statusBadge(rule: InboxRule) {
  if (rule.status === 'active') return <Badge variant="success">Active</Badge>
  if (rule.status === 'paused') return <Badge variant="secondary">Paused</Badge>
  return (
    <Badge variant="secondary">
      Learning {Math.min(rule.observations, rule.promotionThreshold)}/{rule.promotionThreshold}
    </Badge>
  )
}

/**
 * Settings card: per-sender inbox automation. Rules are learned from repeated
 * operator choices on "No reply needed" cards or created manually here.
 */
export default function AutomationRulesManager() {
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
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load rules.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [token])

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
      setError(err instanceof Error ? err.message : 'Failed to create rule.')
    } finally {
      setSaving(false)
    }
  }, [token, matchType, matchValue, action])

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
        setError(err instanceof Error ? err.message : 'Failed to update rule.')
      } finally {
        setBusyId(null)
      }
    },
    [token],
  )

  const handleDelete = useCallback(
    async (rule: InboxRule) => {
      if (!token) return
      if (!window.confirm(`Delete rule for ${rule.matchValue}?`)) return
      setBusyId(rule.id)
      setError(null)
      try {
        await deleteInboxRule(token, rule.id)
        setRules((prev) => prev.filter((r) => r.id !== rule.id))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete rule.')
      } finally {
        setBusyId(null)
      }
    },
    [token],
  )

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div>
          <p className="text-sm font-medium text-text-heading">Automation rules</p>
          <p className="text-xs text-text-secondary">
            Learned from your choices on automated mail: matching threads are closed, turned into a
            task, or left for the team without AI drafting.
          </p>
        </div>
        {!creating ? (
          <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
            <Plus size={13} />
            New rule
          </Button>
        ) : null}
      </div>
      <div className="divide-y divide-border/40">
        {error ? <p className="px-4 py-2 text-xs text-status-error">{error}</p> : null}
        {loading ? (
          <p className="px-4 py-4 text-xs text-text-muted">Loading...</p>
        ) : rules.length === 0 && !creating ? (
          <p className="px-4 py-4 text-xs text-text-muted">
            No rules yet. Rules appear automatically when you make the same choice on a "No reply
            needed" card a few times, or create one manually.
          </p>
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
                {MATCH_LABELS[rule.matchType]} &middot; {ACTION_LABELS[rule.action]}
                {rule.hitCount > 0
                  ? ` \u00b7 applied ${rule.hitCount} time${rule.hitCount === 1 ? '' : 's'}`
                  : ''}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {statusBadge(rule)}
              <Button
                size="sm"
                variant="ghost"
                aria-label={rule.status === 'active' ? 'Pause rule' : 'Activate rule'}
                title={rule.status === 'active' ? 'Pause' : 'Activate'}
                disabled={busyId === rule.id}
                onClick={() => void handleToggle(rule)}
              >
                {rule.status === 'active' ? <Pause size={13} /> : <Play size={13} />}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Delete rule"
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
                aria-label="Match type"
                className="h-8 rounded-md border border-border bg-bg-surface px-2 text-sm text-text-primary focus:border-accent/50 focus:outline-none"
              >
                <option value="sender">Sender address</option>
                <option value="domain">Domain</option>
                <option value="list_id">Mailing list id</option>
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
                aria-label="Rule action"
                className="h-8 rounded-md border border-border bg-bg-surface px-2 text-sm text-text-primary focus:border-accent/50 focus:outline-none"
              >
                <option value="auto_close">Auto-close thread</option>
                <option value="auto_task">Create task</option>
                <option value="mute_ai">Skip AI (leave for team)</option>
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="secondary" disabled={saving} onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button size="sm" disabled={saving || !matchValue.trim()} onClick={() => void handleCreate()}>
                {saving ? 'Saving...' : 'Create rule'}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </Card>
  )
}
