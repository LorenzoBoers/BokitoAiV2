import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Copy, Loader2, RefreshCw, Zap } from 'lucide-react'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Label } from '../ui/label'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import {
  rotateWebhookSecret,
  testWebhookTrigger,
  webhookHookUrl,
  type Trigger,
} from '../../lib/orchestration-api'

type Props = {
  trigger: Trigger
  /** One-time secret shown right after create or rotate. */
  revealedSecret?: string | null
  onSecretConsumed?: () => void
  onUpdated?: () => void
  compact?: boolean
}

async function copyText(value: string, label: string) {
  try {
    await navigator.clipboard.writeText(value)
    toast.success(`${label} copied`)
  } catch {
    toast.error(`Could not copy ${label.toLowerCase()}`)
  }
}

export function WebhookTriggerPanel({
  trigger,
  revealedSecret,
  onSecretConsumed,
  onUpdated,
  compact = false,
}: Props) {
  const [rotating, setRotating] = useState(false)
  const [testing, setTesting] = useState(false)
  const [localSecret, setLocalSecret] = useState<string | null>(null)

  const hookUrl = webhookHookUrl(trigger.id)
  const activeSecret = revealedSecret ?? localSecret

  const envSnippet = useMemo(() => {
    const lines = [
      `BOKITO_HOOK_URL=${hookUrl}`,
      `BOKITO_TRIGGER_ID=${trigger.id}`,
    ]
    if (activeSecret) {
      lines.push(`BOKITO_WEBHOOK_SECRET=${activeSecret}`)
    } else {
      lines.push('BOKITO_WEBHOOK_SECRET=<rotate secret to reveal>')
    }
    return lines.join('\n')
  }, [activeSecret, hookUrl, trigger.id])

  const rotate = async () => {
    setRotating(true)
    try {
      const updated = await rotateWebhookSecret(trigger.id)
      if (updated.webhook_secret) {
        setLocalSecret(updated.webhook_secret)
        toast.success('New webhook secret generated. Copy it now — it is shown once.')
      }
      onUpdated?.()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, 'Could not rotate secret.'))
    } finally {
      setRotating(false)
    }
  }

  const testPing = async () => {
    setTesting(true)
    try {
      const result = await testWebhookTrigger(trigger.id)
      if (result.ok) {
        toast.success(`Test webhook sent (${result.status ?? 'ok'})`)
      } else {
        toast.error('Test webhook failed')
      }
      onUpdated?.()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, 'Could not send test webhook.'))
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className={`rounded-lg border border-border/70 bg-bg-surface/60 ${compact ? 'p-3' : 'p-4'} space-y-3`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-text-heading">External webhook</p>
          <p className="text-xs text-text-muted mt-0.5">
            POST JSON to the hook URL with header X-Bokito-Secret or ?secret= query param.
          </p>
        </div>
        <Badge variant={trigger.has_webhook_secret || activeSecret ? 'success' : 'neutral'}>
          {trigger.has_webhook_secret || activeSecret ? 'Secret configured' : 'No secret'}
        </Badge>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-text-muted">Hook URL</Label>
        <div className="flex gap-2">
          <code className="flex-1 truncate rounded-md border border-border/60 bg-bg-base px-2 py-1.5 text-xs text-text-secondary">
            {hookUrl}
          </code>
          <Button type="button" size="sm" variant="outline" onClick={() => void copyText(hookUrl, 'Hook URL')}>
            <Copy size={14} />
          </Button>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-text-muted">Trigger ID</Label>
        <div className="flex gap-2">
          <code className="flex-1 truncate rounded-md border border-border/60 bg-bg-base px-2 py-1.5 text-xs text-text-secondary">
            {trigger.id}
          </code>
          <Button type="button" size="sm" variant="outline" onClick={() => void copyText(trigger.id, 'Trigger ID')}>
            <Copy size={14} />
          </Button>
        </div>
      </div>

      {activeSecret ? (
        <div className="space-y-1.5 rounded-md border border-status-warning/40 bg-status-warning/5 p-3">
          <Label className="text-xs text-text-muted">Webhook secret (shown once)</Label>
          <div className="flex gap-2">
            <code className="flex-1 break-all rounded-md border border-border/60 bg-bg-base px-2 py-1.5 text-xs text-text-secondary">
              {activeSecret}
            </code>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void copyText(activeSecret, 'Webhook secret')}
            >
              <Copy size={14} />
            </Button>
          </div>
          {onSecretConsumed ? (
            <Button type="button" size="sm" variant="ghost" className="text-xs" onClick={onSecretConsumed}>
              I copied the secret
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label className="text-xs text-text-muted">Integration credentials (.env)</Label>
        <pre className="overflow-x-auto rounded-md border border-border/60 bg-bg-base p-2 text-[11px] text-text-secondary whitespace-pre-wrap">
          {envSnippet}
        </pre>
        <Button type="button" size="sm" variant="outline" onClick={() => void copyText(envSnippet, 'Env snippet')}>
          <Copy size={14} className="mr-1.5" />
          Copy env snippet
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="secondary" disabled={testing} onClick={() => void testPing()}>
          {testing ? <Loader2 size={14} className="animate-spin mr-1.5" /> : <Zap size={14} className="mr-1.5" />}
          Test ping
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={rotating} onClick={() => void rotate()}>
          {rotating ? <Loader2 size={14} className="animate-spin mr-1.5" /> : <RefreshCw size={14} className="mr-1.5" />}
          Rotate secret
        </Button>
      </div>
    </div>
  )
}
