import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
import { Button } from '../ui/button'
import { AutonomousProposalCard } from './AutonomousProposalCard'
import { RunStatusIndicator } from './RunStatusIndicator'
import { listMessages, type MessageRow } from '../../lib/messages-api'
import { messageWorkLogUrl } from '../../lib/workforce-run-urls'

function workLogIdFromMessage(message: MessageRow): string | null {
  const payload = message.payload ?? {}
  const id = payload.work_log_id ?? payload.workLogId
  return typeof id === 'string' && id.trim() ? id : null
}

function projectIdFromMessage(message: MessageRow): string | null {
  if (typeof message.project_id === 'string' && message.project_id) return message.project_id
  const fromPayload = message.payload?.project_id
  return typeof fromPayload === 'string' ? fromPayload : null
}

function agentIdFromMessage(message: MessageRow): string | null {
  const fromPayload = message.payload?.agent_id ?? message.payload?.agentId
  return typeof fromPayload === 'string' && fromPayload.trim() ? fromPayload : null
}

function isAutonomousProposal(message: MessageRow): boolean {
  const kind = message.payload?.kind
  return (
    kind === 'autonomous_proposal' ||
    kind === 'high_risk_autonomous_proposal' ||
    message.payload?.high_risk === true
  )
}

function StandardDecisionCard({ message }: { message: MessageRow }) {
  return (
    <div className="rounded-lg border border-border/60 bg-bg-surface p-4">
      <h3 className="font-medium text-text-primary">{message.subject || 'Decision needed'}</h3>
      <p className="mt-2 whitespace-pre-wrap text-sm text-text-primary">{message.body}</p>
    </div>
  )
}

export function DecisionsPanel() {
  const [decisions, setDecisions] = useState<MessageRow[]>([])
  const [updates, setUpdates] = useState<MessageRow[]>([])
  const [results, setResults] = useState<MessageRow[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('decisions')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [decisionRows, updateRows, resultRows] = await Promise.all([
        listMessages({ message_type: 'decision_request', status: 'awaiting_human' }),
        listMessages({ message_type: 'status_update' }),
        listMessages({ message_type: 'task_result' }),
      ])
      setDecisions(decisionRows)
      setUpdates(updateRows.slice(0, 50))
      setResults(resultRows.slice(0, 50))
    } catch {
      setDecisions([])
      setUpdates([])
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-start justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Messages</h1>
          <p className="text-sm text-text-muted">Decisions from your AI team and project updates.</p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-1 h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden />
          Refresh
        </Button>
      </div>
      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <TabsList className="mx-4 mt-3">
          <TabsTrigger value="decisions">Decisions</TabsTrigger>
          <TabsTrigger value="updates">Updates</TabsTrigger>
          <TabsTrigger value="results">Results</TabsTrigger>
        </TabsList>
        <TabsContent value="decisions" className="flex-1 overflow-y-auto px-4 pb-6">
          {loading ? (
            <p className="text-sm text-text-muted">Loading...</p>
          ) : decisions.length === 0 ? (
            <div className="space-y-3 pt-2">
              <p className="text-sm text-text-muted">No open decisions right now.</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" asChild>
                  <Link to="/govern">Review platform drafts</Link>
                </Button>
                <Button type="button" size="sm" variant="ghost" asChild>
                  <Link to="/os">Open AI OS canvas</Link>
                </Button>
              </div>
            </div>
          ) : (
            <ul className="space-y-4 pt-2">
              {decisions.map((message) => {
                const workLogId = workLogIdFromMessage(message)
                return (
                  <li key={message.id}>
                    {isAutonomousProposal(message) ? (
                      <AutonomousProposalCard message={message} onResolved={() => void load()} />
                    ) : (
                      <StandardDecisionCard message={message} />
                    )}
                    {workLogId ? <RunStatusIndicator workLogId={workLogId} /> : null}
                  </li>
                )
              })}
            </ul>
          )}
        </TabsContent>
        <TabsContent value="updates" className="flex-1 overflow-y-auto px-4 pb-6">
          {loading ? (
            <p className="text-sm text-text-muted">Loading...</p>
          ) : updates.length === 0 ? (
            <p className="text-sm text-text-muted">No updates yet.</p>
          ) : (
            <ul className="space-y-3 pt-2">
              {updates.map((message) => (
                <li
                  key={message.id}
                  className="rounded-lg border border-border/60 bg-bg-surface p-4"
                >
                  <h3 className="font-medium text-text-primary">{message.subject || 'Update'}</h3>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-text-primary">{message.body}</p>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
        <TabsContent value="results" className="flex-1 overflow-y-auto px-4 pb-6">
          {loading ? (
            <p className="text-sm text-text-muted">Loading...</p>
          ) : results.length === 0 ? (
            <p className="text-sm text-text-muted">No task results yet.</p>
          ) : (
            <ul className="space-y-3 pt-2">
              {results.map((message) => {
                const workLogId = workLogIdFromMessage(message)
                return (
                  <li
                    key={message.id}
                    className="rounded-lg border border-border/60 bg-bg-surface p-4"
                  >
                    <h3 className="font-medium text-text-primary">{message.subject || 'Task result'}</h3>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-text-primary">{message.body}</p>
                    {workLogId ? (
                      <Link
                        to={messageWorkLogUrl(
                          workLogId,
                          projectIdFromMessage(message),
                          agentIdFromMessage(message),
                        )}
                        className="mt-2 inline-block text-sm text-accent hover:underline"
                      >
                        View run
                      </Link>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
