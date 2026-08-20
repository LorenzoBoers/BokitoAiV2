import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Check,
  Copy,
  Loader2,
  Plus,
  Send,
  Trash2,
  Webhook as WebhookIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { PageContent } from '../components/layout/PageContent'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import {
  createWebhook,
  deleteWebhook,
  listWebhookDeliveries,
  listWebhooks,
  testWebhook,
  updateWebhook,
  type WebhookDelivery,
  type WebhookEndpoint,
} from '../lib/webhooks-api'

function formatTime(iso: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : '-'
}

function StatusPill({ endpoint }: { endpoint: WebhookEndpoint }) {
  if (!endpoint.last_status) {
    return <span className="text-[11px] text-text-muted">No deliveries yet</span>
  }
  const ok = endpoint.last_status !== 'failed'
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium ${
        ok ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'
      }`}
    >
      {ok ? `Last delivery ${endpoint.last_status}` : 'Last delivery failed'}
    </span>
  )
}

export default function DeveloperSettings() {
  const [items, setItems] = useState<WebhookEndpoint[]>([])
  const [eventCatalog, setEventCatalog] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [showAdd, setShowAdd] = useState(false)
  const [newUrl, setNewUrl] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newEvents, setNewEvents] = useState<string[]>(['*'])
  const [busy, setBusy] = useState(false)

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [deliveries, setDeliveries] = useState<Record<string, WebhookDelivery[]>>({})
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await listWebhooks()
      setItems(data.items)
      setEventCatalog(data.events)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load webhooks.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function toggleNewEvent(event: string) {
    setNewEvents((prev) => {
      if (event === '*') return ['*']
      const withoutAll = prev.filter((e) => e !== '*')
      const next = withoutAll.includes(event)
        ? withoutAll.filter((e) => e !== event)
        : [...withoutAll, event]
      return next.length ? next : ['*']
    })
  }

  async function handleCreate() {
    const url = newUrl.trim()
    if (!url) return
    setBusy(true)
    try {
      await createWebhook({ url, description: newDescription.trim(), events: newEvents })
      setNewUrl('')
      setNewDescription('')
      setNewEvents(['*'])
      setShowAdd(false)
      toast.success('Webhook endpoint added.')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add webhook.')
    } finally {
      setBusy(false)
    }
  }

  async function handleToggleActive(endpoint: WebhookEndpoint) {
    try {
      await updateWebhook(endpoint.id, { active: !endpoint.active })
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update webhook.')
    }
  }

  async function handleDelete(endpoint: WebhookEndpoint) {
    if (!window.confirm(`Remove webhook ${endpoint.url}?`)) return
    try {
      await deleteWebhook(endpoint.id)
      toast.success('Webhook removed.')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove webhook.')
    }
  }

  async function handleTest(endpoint: WebhookEndpoint) {
    try {
      const result = await testWebhook(endpoint.id)
      if (result.status === 'delivered') {
        toast.success(`Test delivered (HTTP ${result.status_code}).`)
      } else {
        toast.error(`Test failed after ${result.attempts} attempt(s): ${result.error}`)
      }
      await load()
      if (expandedId === endpoint.id) await loadDeliveries(endpoint.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Test delivery failed.')
    }
  }

  async function loadDeliveries(endpointId: string) {
    try {
      const data = await listWebhookDeliveries(endpointId)
      setDeliveries((prev) => ({ ...prev, [endpointId]: data.items }))
    } catch {
      // Listing failures leave the previous rows in place.
    }
  }

  async function handleToggleDeliveries(endpointId: string) {
    if (expandedId === endpointId) {
      setExpandedId(null)
      return
    }
    setExpandedId(endpointId)
    await loadDeliveries(endpointId)
  }

  async function handleCopySecret(endpoint: WebhookEndpoint) {
    if (!endpoint.secret) return
    try {
      await navigator.clipboard.writeText(endpoint.secret)
      setCopiedId(endpoint.id)
      window.setTimeout(() => setCopiedId(null), 1600)
    } catch {
      toast.error('Could not copy the secret.')
    }
  }

  return (
    <PageContent>
      <div className="max-w-3xl space-y-8">
        <section>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-[15px] font-semibold text-text-heading">Webhooks</h2>
              <p className="mt-1 text-[12.5px] leading-relaxed text-text-secondary">
                Receive signed HTTP callbacks when signals are created or closed and when
                decisions are raised or resolved. Every request carries an
                <code className="mx-1 rounded bg-bg-surface-hover px-1 py-0.5 text-[11px]">X-Bokito-Signature</code>
                header: an HMAC-SHA256 of <code className="rounded bg-bg-surface-hover px-1 py-0.5 text-[11px]">{'{timestamp}.{body}'}</code> with your endpoint secret.
              </p>
            </div>
            <Button size="sm" onClick={() => setShowAdd((v) => !v)}>
              <Plus size={14} className="mr-1" /> Add endpoint
            </Button>
          </div>

          {showAdd ? (
            <div className="mt-4 space-y-3 rounded-xl border border-border/60 bg-bg-surface p-4">
              <div>
                <Label htmlFor="wh-url">Endpoint URL</Label>
                <Input
                  id="wh-url"
                  placeholder="https://example.com/bokito-webhook"
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="wh-desc">Description (optional)</Label>
                <Input
                  id="wh-desc"
                  placeholder="CRM sync"
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                />
              </div>
              <div>
                <Label>Events</Label>
                <div className="mt-1 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => toggleNewEvent('*')}
                    className={`rounded-full border px-2.5 py-1 text-[11.5px] transition-colors ${
                      newEvents.includes('*')
                        ? 'border-accent/50 bg-accent/10 text-accent'
                        : 'border-border/60 text-text-secondary hover:bg-bg-hover'
                    }`}
                  >
                    All events
                  </button>
                  {eventCatalog.map((event) => (
                    <button
                      key={event}
                      type="button"
                      onClick={() => toggleNewEvent(event)}
                      className={`rounded-full border px-2.5 py-1 text-[11.5px] transition-colors ${
                        newEvents.includes(event)
                          ? 'border-accent/50 bg-accent/10 text-accent'
                          : 'border-border/60 text-text-secondary hover:bg-bg-hover'
                      }`}
                    >
                      {event}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleCreate} disabled={busy || !newUrl.trim()}>
                  {busy ? <Loader2 size={14} className="mr-1 animate-spin" /> : null}
                  Add webhook
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}

          {loading ? (
            <div className="mt-6 flex items-center gap-2 text-[12.5px] text-text-muted">
              <Loader2 size={14} className="animate-spin" /> Loading webhooks...
            </div>
          ) : error ? (
            <p className="mt-6 text-[12.5px] text-red-500">{error}</p>
          ) : items.length === 0 ? (
            <div className="mt-6 flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/60 py-10 text-center">
              <WebhookIcon size={20} className="text-text-muted" />
              <p className="text-[12.5px] text-text-muted">
                No webhook endpoints yet. Add one to push events to your own systems.
              </p>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {items.map((endpoint) => (
                <div
                  key={endpoint.id}
                  className="rounded-xl border border-border/60 bg-bg-surface p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-[12.5px] text-text-primary">
                        {endpoint.url}
                      </p>
                      {endpoint.description ? (
                        <p className="text-[11.5px] text-text-muted">{endpoint.description}</p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <StatusPill endpoint={endpoint} />
                      <Button size="sm" variant="ghost" onClick={() => handleTest(endpoint)}>
                        <Send size={13} className="mr-1" /> Test
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleToggleActive(endpoint)}
                      >
                        {endpoint.active ? 'Disable' : 'Enable'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-500 hover:text-red-600"
                        onClick={() => handleDelete(endpoint)}
                        aria-label="Delete webhook"
                      >
                        <Trash2 size={13} />
                      </Button>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {!endpoint.active ? (
                      <span className="rounded-full bg-bg-surface-hover px-2 py-0.5 text-[10.5px] font-medium text-text-muted">
                        Disabled
                      </span>
                    ) : null}
                    {endpoint.events.map((event) => (
                      <span
                        key={event}
                        className="rounded-full border border-border/50 px-2 py-0.5 text-[10.5px] text-text-secondary"
                      >
                        {event === '*' ? 'All events' : event}
                      </span>
                    ))}
                  </div>
                  {endpoint.secret ? (
                    <div className="mt-2 flex items-center gap-1.5">
                      <span className="text-[11px] text-text-muted">Signing secret</span>
                      <code className="rounded bg-bg-surface-hover px-1.5 py-0.5 font-mono text-[11px] text-text-secondary">
                        {endpoint.secret.slice(0, 12)}...
                      </code>
                      <button
                        type="button"
                        onClick={() => handleCopySecret(endpoint)}
                        className="flex items-center gap-1 text-[11px] text-text-muted hover:text-text-primary"
                      >
                        {copiedId === endpoint.id ? (
                          <>
                            <Check size={11} /> Copied
                          </>
                        ) : (
                          <>
                            <Copy size={11} /> Copy
                          </>
                        )}
                      </button>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => handleToggleDeliveries(endpoint.id)}
                    className="mt-2 text-[11.5px] font-medium text-accent hover:underline"
                  >
                    {expandedId === endpoint.id ? 'Hide deliveries' : 'Recent deliveries'}
                  </button>
                  {expandedId === endpoint.id ? (
                    <div className="mt-2 overflow-hidden rounded-lg border border-border/50">
                      {(deliveries[endpoint.id] || []).length === 0 ? (
                        <p className="px-3 py-2.5 text-[11.5px] text-text-muted">
                          No deliveries recorded yet.
                        </p>
                      ) : (
                        <table className="w-full text-[11.5px]">
                          <thead>
                            <tr className="border-b border-border/50 text-left text-text-muted">
                              <th className="px-3 py-1.5 font-medium">Event</th>
                              <th className="px-3 py-1.5 font-medium">Status</th>
                              <th className="px-3 py-1.5 font-medium">Attempts</th>
                              <th className="px-3 py-1.5 font-medium">Time</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(deliveries[endpoint.id] || []).map((delivery) => (
                              <tr key={delivery.id} className="border-b border-border/30 last:border-0">
                                <td className="px-3 py-1.5 font-mono">{delivery.event}</td>
                                <td className="px-3 py-1.5">
                                  <span
                                    className={
                                      delivery.status === 'delivered'
                                        ? 'text-emerald-500'
                                        : delivery.status === 'failed'
                                          ? 'text-red-500'
                                          : 'text-text-muted'
                                    }
                                  >
                                    {delivery.status}
                                    {delivery.status_code ? ` (${delivery.status_code})` : ''}
                                  </span>
                                </td>
                                <td className="px-3 py-1.5">{delivery.attempts}</td>
                                <td className="px-3 py-1.5 text-text-muted">
                                  {formatTime(delivery.created_at)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-border/60 bg-bg-surface p-4">
          <h2 className="text-[15px] font-semibold text-text-heading">Public API</h2>
          <p className="mt-1 text-[12.5px] leading-relaxed text-text-secondary">
            Use a tenant API token as a bearer token against{' '}
            <code className="rounded bg-bg-surface-hover px-1 py-0.5 text-[11px]">/api/public/v1/signals</code>{' '}
            to list and read inbox signals, or POST to push external events into the inbox as
            new signals. Tokens are managed under{' '}
            <Link to="/settings/autonomy" className="text-accent hover:underline">
              Autonomy &amp; approvals
            </Link>
            .
          </p>
        </section>
      </div>
    </PageContent>
  )
}
