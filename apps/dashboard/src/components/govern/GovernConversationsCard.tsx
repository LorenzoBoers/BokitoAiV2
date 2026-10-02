import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Pause, Play, ShieldAlert } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Switch } from '../ui/switch'
import { AiHandlingIcon } from '../ai/AiHandlingIcon'
import { AI_HANDLING_SETTINGS_PATH } from '../ai/AiHandlingPicker'
import { useAuth } from '../../context/AuthContext'
import {
  getAiHandlingOverview,
  resetAiBreaker,
  saveAiHandlingSettings,
  type AiHandlingBreaker,
  type AiHandlingOverview,
} from '../../lib/ai-handling-api'
import { patchCaseType } from '../../lib/cases-api'
import type { AllowanceMode, AutonomyScopeRow } from '../../lib/govern-api'
import { signalTypeLabel } from '../../lib/signal-type-catalog'
import { inboxPath } from '../../lib/messages-paths'

type Props = {
  messagingMode: AllowanceMode | undefined
  onMessagingChange: (mode: AllowanceMode) => void | Promise<void>
  caseTypes: AutonomyScopeRow[]
  onCaseTypeChanged: (row: AutonomyScopeRow) => void
  saving?: boolean
}

/**
 * Govern view of AI handling: the ceiling every conversation sits under, what
 * currently runs autonomously, which signal types never send on their own,
 * and the circuit breaker.
 */
export default function GovernConversationsCard({
  messagingMode,
  onMessagingChange,
  caseTypes,
  onCaseTypeChanged,
  saving = false,
}: Props) {
  const { t, i18n } = useTranslation('govern')
  const { t: tc } = useTranslation('common')
  const { token } = useAuth()
  const [overview, setOverview] = useState<AiHandlingOverview | null>(null)
  const [breaker, setBreaker] = useState<AiHandlingBreaker | null>(null)
  const [savingBreaker, setSavingBreaker] = useState(false)
  const [busyTypeId, setBusyTypeId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!token) return
    try {
      const next = await getAiHandlingOverview(token)
      setOverview(next)
      setBreaker(next.breaker)
    } catch {
      setOverview(null)
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load, messagingMode])

  const breakerDirty = overview != null && breaker != null && JSON.stringify(breaker) !== JSON.stringify(overview.breaker)

  const saveBreaker = async () => {
    if (!token || !breaker) return
    setSavingBreaker(true)
    try {
      const next = await saveAiHandlingSettings(token, { breaker })
      setOverview(next)
      setBreaker(next.breaker)
      toast.success(t('conversations.breakerSaved'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tc('aiHandling.saveError'))
    } finally {
      setSavingBreaker(false)
    }
  }

  const resetBreaker = async (accountId: string) => {
    if (!token) return
    try {
      await resetAiBreaker(token, accountId)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tc('aiHandling.saveError'))
    }
  }

  const toggleSendMode = async (row: AutonomyScopeRow, reviewed: boolean) => {
    setBusyTypeId(row.id)
    try {
      const updated = await patchCaseType(row.id, { send_mode: reviewed ? 'draft' : 'send' })
      onCaseTypeChanged({ ...row, send_mode: updated.send_mode })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tc('aiHandling.saveError'))
    } finally {
      setBusyTypeId(null)
    }
  }

  const ceiling = overview?.ceiling ?? 'autonomous'
  const paused = messagingMode === 'ask' || messagingMode === 'deny'
  const autonomous = overview
    ? [
        ...overview.exceptions.channels.filter((row) => row.mode === 'autonomous').map((row) => ({ ...row, scope: 'channel' as const })),
        ...overview.exceptions.contacts.filter((row) => row.mode === 'autonomous').map((row) => ({ ...row, scope: 'contact' as const })),
        ...overview.exceptions.conversations.filter((row) => row.mode === 'autonomous').map((row) => ({ ...row, scope: 'conversation' as const })),
      ]
    : []
  const tripped = overview?.exceptions.channels.filter((row) => row.breakerTrippedAt) ?? []
  const customerTypes = caseTypes.filter((row) => row.send_mode)

  return (
    <Card data-testid="govern-conversations">
      <CardHeader>
        <CardTitle>{t('conversations.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-xs text-text-muted">{t('conversations.intro')}</p>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 p-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <AiHandlingIcon mode={ceiling} size={16} className="mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-text-heading">
                {t('conversations.ceiling', { mode: tc(`aiHandling.modes.${ceiling}.label`) })}
              </p>
              <p className="mt-0.5 text-xs text-text-muted">
                {overview?.clampedBy
                  ? tc(`aiHandling.clamped.${overview.clampedBy}`, { mode: tc(`aiHandling.modes.${ceiling}.label`) })
                  : t('conversations.ceilingHint')}
              </p>
              {overview ? (
                <p className="mt-1 text-xs text-text-secondary">
                  {t('conversations.workspaceDefault', {
                    mode: tc(`aiHandling.modes.${overview.workspace.effective}.label`),
                  })}{' '}
                  <Link to={AI_HANDLING_SETTINGS_PATH} className="font-medium text-accent hover:underline">
                    {t('conversations.openSettings')}
                  </Link>
                </p>
              ) : null}
            </div>
          </div>
          <Button
            size="sm"
            variant={paused ? 'secondary' : 'outline'}
            disabled={saving || messagingMode === undefined}
            onClick={() => void onMessagingChange(paused ? 'allow' : 'ask')}
            data-testid="govern-conversations-pause"
          >
            {paused ? <Play size={13} /> : <Pause size={13} />}
            {paused ? t('conversations.resume') : t('conversations.pause')}
          </Button>
        </div>

        <section className="space-y-2">
          <h4 className="text-xs font-semibold text-text-muted">{t('conversations.autonomousTitle')}</h4>
          {!overview ? null : autonomous.length === 0 && overview.workspace.effective !== 'autonomous' ? (
            <p className="text-xs text-text-secondary">{t('conversations.autonomousNone')}</p>
          ) : (
            <ul className="divide-y divide-border/50 rounded-lg border border-border/60">
              {overview.workspace.effective === 'autonomous' ? (
                <li className="flex items-center gap-2 px-3 py-2 text-sm text-text-primary">
                  <AiHandlingIcon mode="autonomous" size={13} />
                  {t('conversations.autonomousWorkspace')}
                </li>
              ) : null}
              {autonomous.map((row) => (
                <li key={`${row.scope}-${row.id}`} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <AiHandlingIcon mode="autonomous" size={13} />
                  <Link
                    to={
                      row.scope === 'contact'
                        ? `/contacts/${row.id}`
                        : row.scope === 'conversation'
                          ? inboxPath('open', row.id)
                          : '/settings/channels'
                    }
                    className="min-w-0 flex-1 truncate-fade text-text-primary hover:text-accent"
                  >
                    {row.label || row.contactName || row.address || row.id}
                  </Link>
                  <span className="shrink-0 text-xs text-text-muted">{tc(`aiHandling.sources.${row.scope}`)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2">
          <h4 className="text-xs font-semibold text-text-muted">{t('conversations.reviewedTypesTitle')}</h4>
          <p className="text-xs text-text-muted">{t('conversations.reviewedTypesHint')}</p>
          {customerTypes.length === 0 ? (
            <p className="text-xs text-text-secondary">{t('conversations.noTypes')}</p>
          ) : (
            <ul className="divide-y divide-border/50 rounded-lg border border-border/60">
              {customerTypes.map((row) => {
                const reviewed = row.send_mode !== 'send'
                return (
                  <li key={row.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="min-w-0 truncate-fade text-sm text-text-primary">
                      {signalTypeLabel({ slug: row.slug, name: row.name }, i18n.language)}
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-text-muted">
                      {reviewed ? t('conversations.alwaysReview') : t('conversations.mayAutoSend')}
                      <Switch
                        checked={reviewed}
                        disabled={busyTypeId === row.id}
                        onCheckedChange={(checked) => void toggleSendMode(row, checked)}
                        aria-label={t('conversations.alwaysReview')}
                      />
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-xs font-semibold text-text-muted">{t('conversations.breakerTitle')}</h4>
              <p className="mt-0.5 text-xs text-text-muted">{t('conversations.breakerHint')}</p>
            </div>
            {breaker ? (
              <Switch
                checked={breaker.enabled}
                onCheckedChange={(checked) => setBreaker((prev) => (prev ? { ...prev, enabled: checked } : prev))}
                aria-label={t('conversations.breakerTitle')}
              />
            ) : null}
          </div>
          {breaker?.enabled ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs text-text-secondary">
                <span>{t('conversations.maxAutonomous')}</span>
                <Input
                  type="number"
                  min={1}
                  max={1000}
                  value={breaker.maxAutonomousPerHour}
                  onChange={(e) =>
                    setBreaker((prev) => (prev ? { ...prev, maxAutonomousPerHour: Number(e.target.value) || 1 } : prev))
                  }
                />
              </label>
              <label className="space-y-1 text-xs text-text-secondary">
                <span>{t('conversations.maxNegative')}</span>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={breaker.maxNegativePerHour}
                  onChange={(e) =>
                    setBreaker((prev) => (prev ? { ...prev, maxNegativePerHour: Number(e.target.value) || 1 } : prev))
                  }
                />
              </label>
            </div>
          ) : null}
          {breakerDirty ? (
            <Button size="sm" disabled={savingBreaker} onClick={() => void saveBreaker()}>
              {t('conversations.breakerSave')}
            </Button>
          ) : null}
          {tripped.length > 0 ? (
            <ul className="divide-y divide-border/50 rounded-lg border border-status-warning/30">
              {tripped.map((row) => (
                <li key={row.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <Badge variant="warning" className="gap-1 px-1.5 py-0 text-2xs">
                    <ShieldAlert size={10} />
                    {tc('aiHandling.breakerBadge')}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate-fade text-text-primary">{row.label}</span>
                  <Button size="sm" variant="outline" onClick={() => void resetBreaker(row.id)}>
                    {tc('aiHandling.breakerResume')}
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </CardContent>
    </Card>
  )
}
