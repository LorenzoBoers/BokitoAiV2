import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Play, Pause, RefreshCw, Zap } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import {
  forceRescanWorkforce,
  forceWakeWorkforce,
  getWorkforceConfig,
  getWorkforceStatus,
  pauseWorkforce,
  updateWorkforceConfig,
  type WorkforceConfig,
  type WorkforceStatusPayload,
} from '../lib/workforce-api'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import AgentCanvasMermaid from '../components/orchestrator/AgentCanvasMermaid'
import AssistantEditor, { type AssistantEditorConfig } from '../components/workforce/AssistantEditor'

function formatTs(value: number | undefined): string {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

const DEFAULT_ASSISTANT_EDITOR_CONFIG: AssistantEditorConfig = {
  name: 'Bokito Assistent',
  tagline: 'Altijd beschikbaar',
  avatarInitials: 'BA',
  avatarColor: '#00FF99',
  primaryColor: '#00FF99',
  userBubbleColor: '#00FF99',
  backgroundColor: '#1A1F2E',
  fontFamily: 'Inter',
  widgetWidth: 380,
  welcomeMessage: 'Hoi! Hoe kan ik je vandaag helpen?',
  model: 'gpt-4o',
  language: 'nl',
  temperature: 0.7,
  wakeTemplate: 'Pak deze taak op en geef een korte statusupdate.',
  launcherPosition: 'bottom-right',
  launcherLabel: 'Chat met ons',
  showLauncherLabel: false,
  openOnLoad: false,
  systemPrompt:
    'Je bent een behulpzame AI-assistent voor {bedrijfsnaam}. Je spreekt altijd Nederlands tenzij de gebruiker een andere taal gebruikt. Wees vriendelijk, duidelijk en to-the-point.',
}

export default function WorkforceControl() {
  const { token, user } = useAuth()
  const [view, setView] = useState<'canvas' | 'control' | 'assistant'>('canvas')
  const [config, setConfig] = useState<WorkforceConfig | null>(null)
  const [status, setStatus] = useState<WorkforceStatusPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [checkIntervalSec, setCheckIntervalSec] = useState(120)
  const [maxRetry, setMaxRetry] = useState(3)
  const [allowOverride, setAllowOverride] = useState(false)
  const [autonomyLevel, setAutonomyLevel] = useState<'safe' | 'medium' | 'full'>('safe')
  const [assistantConfig, setAssistantConfig] = useState<AssistantEditorConfig>(DEFAULT_ASSISTANT_EDITOR_CONFIG)

  useEffect(() => {
    const raw = localStorage.getItem('workforce_assistant_config')
    if (!raw) return
    try {
      const parsed = JSON.parse(raw) as Partial<AssistantEditorConfig>
      setAssistantConfig((prev) => ({
        ...prev,
        ...parsed,
      }))
    } catch {
      // ignore invalid persisted config
    }
  }, [])

  const refresh = useCallback(async () => {
    if (!token) return
    setIsLoading(true)
    setError(null)
    try {
      const [cfg, stat] = await Promise.all([getWorkforceConfig(token), getWorkforceStatus(token, 1)])
      setConfig(cfg)
      setStatus(stat)
      setCheckIntervalSec(cfg.check_interval_sec ?? 120)
      setMaxRetry(cfg.max_retry_per_feature ?? 3)
      setAllowOverride(Boolean(cfg.allow_verdict_override))
      setAutonomyLevel((cfg.autonomy_level as 'safe' | 'medium' | 'full') ?? 'safe')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kon workforce status niet laden.')
      setStatus(null)
    } finally {
      setIsLoading(false)
    }
  }, [token])

  useEffect(() => {
    if (view !== 'control') return
    void refresh()
  }, [refresh, view])

  const pipelineSummary = useMemo(() => {
    const first = status?.pipelines?.[0] as Record<string, unknown> | undefined
    if (!first) return { state: 'unknown', next: '-' }
    return {
      state: String(first.status ?? 'unknown'),
      next: formatTs(Number(first.next_auto_check_at ?? 0)),
    }
  }, [status])

  const handleSavePolicy = async () => {
    if (!token || !config) return
    setIsSaving(true)
    setError(null)
    try {
      const updated = await updateWorkforceConfig(token, {
        check_interval_sec: Math.max(30, checkIntervalSec),
        max_retry_per_feature: Math.max(1, maxRetry),
        allow_verdict_override: allowOverride,
        autonomy_level: autonomyLevel,
      })
      setConfig(updated)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Opslaan van policy is mislukt.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleToggleEnabled = async () => {
    if (!token || !config) return
    setIsSaving(true)
    setError(null)
    try {
      const updated = await updateWorkforceConfig(token, {
        enabled: !config.enabled,
      })
      setConfig(updated)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Toggle is mislukt.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleForceWake = async () => {
    if (!token) return
    setIsSaving(true)
    setError(null)
    try {
      await forceWakeWorkforce(token, 1)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Force wake is mislukt.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleForceRescan = async () => {
    if (!token) return
    setIsSaving(true)
    setError(null)
    try {
      await forceRescanWorkforce(token, 1)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Force rescan is mislukt.')
    } finally {
      setIsSaving(false)
    }
  }

  const handlePause = async () => {
    if (!token) return
    setIsSaving(true)
    setError(null)
    try {
      await pauseWorkforce(token)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Naar standby zetten is mislukt.')
    } finally {
      setIsSaving(false)
    }
  }

  if (view === 'canvas') {
    return (
      <div className="h-full min-h-0 -mx-3 -mb-3">
        {token ? (
          <AgentCanvasMermaid
            token={token}
            pipelineId={1}
            tenantName={user?.tenant?.name}
            onOpenControl={() => setView('control')}
            onOpenAssistantConfig={() => setView('assistant')}
          />
        ) : (
          <Card>
            <CardContent className="pt-3 text-sm text-text-secondary">Geen auth token beschikbaar.</CardContent>
          </Card>
        )}
      </div>
    )
  }

  if (view === 'assistant') {
    const handleSaveAssistantConfig = () => {
      localStorage.setItem(
        'workforce_assistant_config',
        JSON.stringify(assistantConfig),
      )
    }

    return (
      <div className="h-full min-h-0 -mx-3 -mb-3">
        <AssistantEditor
          config={assistantConfig}
          onChange={setAssistantConfig}
          onSave={handleSaveAssistantConfig}
          onBack={() => setView('canvas')}
          onReset={() => setAssistantConfig(DEFAULT_ASSISTANT_EDITOR_CONFIG)}
        />
      </div>
    )
  }

  return (
    <div className="h-full min-h-0 space-y-3 overflow-y-auto pr-1">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Workforce Control</CardTitle>
            <p className="text-xs text-text-secondary mt-0.5">
              Bestuur de autonome dirigent voor pipeline self-healing en planning.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => setView('canvas')}>
              Terug naar canvas
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void refresh()} disabled={isLoading || isSaving}>
              {isLoading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              Vernieuwen
            </Button>
          </div>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-[1.2fr_1fr] gap-3">
        <Card>
          <CardHeader>
            <CardTitle>Autonomy Policies</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-text-secondary">
                Check interval (sec)
                <input
                  type="number"
                  min={30}
                  className="mt-1 h-9 w-full rounded-md border border-border bg-bg-input px-3 text-sm"
                  value={checkIntervalSec}
                  onChange={(event) => setCheckIntervalSec(Number(event.target.value || 120))}
                />
              </label>
              <label className="text-xs text-text-secondary">
                Max retry per feature
                <input
                  type="number"
                  min={1}
                  className="mt-1 h-9 w-full rounded-md border border-border bg-bg-input px-3 text-sm"
                  value={maxRetry}
                  onChange={(event) => setMaxRetry(Number(event.target.value || 3))}
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-text-secondary">
                Autonomy level
                <select
                  className="mt-1 h-9 w-full rounded-md border border-border bg-bg-input px-3 text-sm"
                  value={autonomyLevel}
                  onChange={(event) => setAutonomyLevel(event.target.value as 'safe' | 'medium' | 'full')}
                >
                  <option value="safe">safe</option>
                  <option value="medium">medium</option>
                  <option value="full">full</option>
                </select>
              </label>
              <label className="text-xs text-text-secondary flex items-end gap-2 pb-2">
                <input
                  type="checkbox"
                  checked={allowOverride}
                  onChange={(event) => setAllowOverride(event.target.checked)}
                />
                Allow verdict override
              </label>
            </div>

            <div className="flex items-center gap-2">
              <Button size="sm" onClick={handleSavePolicy} disabled={isSaving || isLoading}>
                {isSaving ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
                Policy opslaan
              </Button>
              <Button size="sm" variant="secondary" onClick={handleToggleEnabled} disabled={isSaving || isLoading}>
                {config?.enabled ? <Pause size={13} /> : <Play size={13} />}
                {config?.enabled ? 'Autonomy uit' : 'Autonomy aan'}
              </Button>
              <Button size="sm" variant="secondary" onClick={handlePause} disabled={isSaving || isLoading}>
                Standby direct
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Live Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-text-secondary">Autonomy</span>
              <Badge variant={config?.enabled ? 'success' : 'neutral'}>{config?.enabled ? 'enabled' : 'disabled'}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-secondary">Pipeline state</span>
              <Badge variant="info">{pipelineSummary.state}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-secondary">Last wake</span>
              <span>{formatTs(config?.last_wake_at)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-secondary">Next wake</span>
              <span>{formatTs(config?.next_wake_at)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-secondary">Pipeline next check</span>
              <span>{pipelineSummary.next}</span>
            </div>

            <div className="pt-2 flex items-center gap-2">
              <Button size="sm" variant="secondary" onClick={handleForceWake} disabled={isSaving || isLoading}>
                Force wake
              </Button>
              <Button size="sm" variant="secondary" onClick={handleForceRescan} disabled={isSaving || isLoading}>
                Force rescan
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-3 min-h-[360px]">
        <Card>
          <CardHeader>
            <CardTitle>Recente taken</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            {(status?.recent_tasks ?? []).slice(0, 8).map((task) => (
              <div key={task.id} className="rounded-md border border-border p-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{task.task_type}</span>
                  <Badge variant="neutral">{task.status}</Badge>
                </div>
                <div className="text-text-secondary mt-1">Planned: {formatTs(task.planned_for)}</div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Agent log</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            {(status?.recent_logs ?? []).slice(0, 8).map((entry) => (
              <div key={entry.id} className="rounded-md border border-border p-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{entry.action_type || 'event'}</span>
                  <Badge variant={entry.level === 'error' ? 'error' : entry.level === 'warn' ? 'warning' : 'info'}>
                    {entry.level}
                  </Badge>
                </div>
                <div className="text-text-secondary mt-1">{entry.message}</div>
                <div className="text-text-muted mt-1">{formatTs(entry.created_at)}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {error && (
        <Card className="border-error/40">
          <CardContent className="pt-3 text-sm text-error">{error}</CardContent>
        </Card>
      )}
    </div>
  )
}
