import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
import { AutonomousProposalCard } from './AutonomousProposalCard'
import { RunStatusIndicator } from './RunStatusIndicator'
import { listMessages, type MessageRow } from '../../lib/messages-api'

function workLogIdFromMessage(message: MessageRow): string | null {
  const payload = message.payload ?? {}
  const id = payload.work_log_id ?? payload.workLogId
  return typeof id === 'string' && id.trim() ? id : null
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
    <div className="rounded-lg border border-border-subtle bg-surface-raised p-4">
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
      <div className="border-b border-border-subtle px-4 py-3">
        <h1 className="text-lg font-semibold text-text-primary">Messages</h1>
        <p className="text-sm text-text-muted">Decisions from your AI team and project updates.</p>
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
            <p className="text-sm text-text-muted">No open decisions right now.</p>
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
                  className="rounded-lg border border-border-subtle bg-surface-raised p-4"
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
                    className="rounded-lg border border-border-subtle bg-surface-raised p-4"
                  >
                    <h3 className="font-medium text-text-primary">{message.subject || 'Task result'}</h3>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-text-primary">{message.body}</p>
                    {workLogId ? (
                      <Link
                        to={`/admin/runs/${workLogId}`}
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
