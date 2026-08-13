import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { Label } from '../ui/label'
import { LoadingBlock } from '../ui/loading-block'
import { listAgents } from '../../lib/agents-api'
import {
  createChannelBinding,
  deleteChannelBinding,
  listChannelBindings,
  type ChannelBinding,
} from '../../lib/channel-bindings-api'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'

const CHANNELS = [
  { value: 'email', label: 'Email' },
  { value: 'widget', label: 'Webchat' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'slack', label: 'Slack' },
] as const

type AgentOption = { id: string; name: string }

export default function ChannelBindingsPanel() {
  const [bindings, setBindings] = useState<ChannelBinding[]>([])
  const [agents, setAgents] = useState<AgentOption[]>([])
  const [loading, setLoading] = useState(true)
  const [channel, setChannel] = useState<string>('email')
  const [agentId, setAgentId] = useState('')
  const [saving, setSaving] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [bindingRows, agentRows] = await Promise.all([
        listChannelBindings(),
        listAgents().catch(() => [] as AgentOption[]),
      ])
      setBindings(bindingRows)
      setAgents(agentRows.map((a) => ({ id: a.id, name: a.name })))
      setAgentId((prev) => prev || agentRows[0]?.id || '')
    } catch (err) {
      toast.error(formatApiErrorMessage(err, 'Could not load channel bindings.'))
      setBindings([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? 'Agent'
  const channelLabel = (value: string) => CHANNELS.find((c) => c.value === value)?.label ?? value

  const addBinding = async () => {
    if (!agentId) {
      toast.error('Pick an agent for this binding.')
      return
    }
    setSaving(true)
    try {
      await createChannelBinding({ channel, agent_id: agentId, priority: 10, enabled: true })
      toast.success('Channel binding created')
      await load()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, 'Could not create binding.'))
    } finally {
      setSaving(false)
    }
  }

  const removeBinding = async (id: string) => {
    setRemovingId(id)
    try {
      await deleteChannelBinding(id)
      toast.success('Binding removed')
      setBindings((prev) => prev.filter((b) => b.id !== id))
    } catch (err) {
      toast.error(formatApiErrorMessage(err, 'Could not remove binding.'))
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <Card className="space-y-5 p-5">
      <div>
        <h2 className="text-sm font-medium text-text-heading">Channel bindings</h2>
        <p className="mt-0.5 text-xs text-text-muted">
          Route inbound conversations on a channel to a specific agent. Without a binding, the
          default assistant handles new threads.
        </p>
      </div>

      {loading ? (
        <LoadingBlock variant="inline" label="Loading bindings..." />
      ) : (
        <>
          {bindings.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border/60 px-3 py-4 text-center text-xs text-text-muted">
              No bindings yet. New messages use the default assistant until you add one.
            </p>
          ) : (
            <ul className="space-y-2">
              {bindings.map((row) => (
                <li
                  key={row.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border/55 bg-bg-elevated/40 px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-text-heading">
                      {channelLabel(row.channel)} → {agentName(row.agent_id)}
                    </p>
                    <p className="text-[11px] text-text-muted">
                      Priority {row.priority}
                      {!row.enabled ? ' · disabled' : ''}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={removingId === row.id}
                    onClick={() => void removeBinding(row.id)}
                    aria-label="Remove binding"
                  >
                    <Trash2 size={14} />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-2 border-t border-border/50 pt-4">
            <Label className="text-xs">Add binding</Label>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                className="h-8 rounded-md border border-border/70 bg-bg-input/80 px-2 text-xs"
              >
                {CHANNELS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
              <select
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                className="h-8 min-w-[10rem] flex-1 rounded-md border border-border/70 bg-bg-input/80 px-2 text-xs"
              >
                {agents.length === 0 ? (
                  <option value="">No agents</option>
                ) : (
                  agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))
                )}
              </select>
              <Button
                type="button"
                size="sm"
                disabled={saving || !agentId}
                onClick={() => void addBinding()}
              >
                {saving ? 'Adding...' : 'Add'}
              </Button>
            </div>
          </div>
        </>
      )}
    </Card>
  )
}
