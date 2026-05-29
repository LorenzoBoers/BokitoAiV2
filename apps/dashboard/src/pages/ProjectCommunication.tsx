import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowUpRight } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader } from '../components/ui/card'
import { ProjectShell } from '../components/project/ProjectShell'
import { WorkforceDecisionList } from '../components/workforce/WorkforceDecisionList'
import { useProjectContext } from '../context/ProjectContext'
import { listMessages, type MessageRow } from '../lib/messages-api'

function MessageList({ rows, empty }: { rows: MessageRow[]; empty: string }) {
  if (!rows.length) return <p className="text-sm text-text-muted">{empty}</p>
  return (
    <ul className="space-y-3">
      {rows.map((msg) => (
        <li
          key={msg.id}
          className="rounded-xl border border-border/70 bg-bg-elevated p-4"
        >
          {msg.subject ? (
            <h3 className="font-medium text-text-primary">{msg.subject}</h3>
          ) : null}
          <p className="mt-1 text-xs text-text-muted">
            {msg.created_at ? new Date(msg.created_at).toLocaleString() : null}
          </p>
          <p className="mt-2 whitespace-pre-wrap text-sm text-text-primary">{msg.body}</p>
        </li>
      ))}
    </ul>
  )
}

export default function ProjectCommunication() {
  const { t } = useTranslation('nav')
  const { projectId } = useProjectContext()
  const [searchParams, setSearchParams] = useSearchParams()
  const [pendingDecisions, setPendingDecisions] = useState<MessageRow[]>([])
  const [resolvedDecisions, setResolvedDecisions] = useState<MessageRow[]>([])
  const [updates, setUpdates] = useState<MessageRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const streamFilter = searchParams.get('stream')?.trim() ?? ''

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [pendingRows, resolvedRows, updateRows] = await Promise.all([
        listMessages({
          message_type: 'decision_request',
          project_id: projectId,
          status: 'awaiting_human',
        }),
        listMessages({
          message_type: 'decision_request',
          project_id: projectId,
          status: 'done',
        }),
        listMessages({ message_type: 'status_update', project_id: projectId }),
      ])
      setPendingDecisions(pendingRows)
      setResolvedDecisions(resolvedRows)
      setUpdates(updateRows)
    } catch (err) {
      setPendingDecisions([])
      setResolvedDecisions([])
      setUpdates([])
      setError(err instanceof Error ? err.message : 'Could not load messages.')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  function detectStreamRef(msg: MessageRow): string | null {
    const payload = msg.payload
    if (!payload) return null
    const candidates = ['stream_slug', 'workstream_slug', 'stream', 'stream_id', 'workflow_stream']
    for (const key of candidates) {
      const value = payload[key]
      if (typeof value === 'string' && value.trim()) return value.trim()
      if (typeof value === 'number') return String(value)
    }
    return null
  }

  const allRows = [...pendingDecisions, ...resolvedDecisions, ...updates]
  const streamOptions = Array.from(
    new Set(allRows.map((row) => detectStreamRef(row)).filter((value): value is string => Boolean(value))),
  )

  function applyStreamFilter(rows: MessageRow[]): MessageRow[] {
    if (!streamFilter) return rows
    return rows.filter((row) => {
      const streamRef = detectStreamRef(row)
      // Mixed mode: keep project-wide rows while filtering stream-specific messages.
      if (!streamRef) return true
      return streamRef === streamFilter
    })
  }

  const pendingRows = applyStreamFilter(pendingDecisions)
  const updateRows = applyStreamFilter(updates)
  const resolvedRows = applyStreamFilter(resolvedDecisions)

  function setFilter(next: string) {
    const params = new URLSearchParams(searchParams)
    if (next) params.set('stream', next)
    else params.delete('stream')
    setSearchParams(params, { replace: true })
  }

  return (
    <ProjectShell>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <p className="text-sm text-text-muted">{t('project.communication.description')}</p>
          <Link
            to="/projects/communication"
            className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
          >
            {t('project.communication.hubLink')}
            <ArrowUpRight size={12} />
          </Link>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-text-muted">{t('project.messages.loading')}</p>
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : (
            <Tabs defaultValue="pending">
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant={streamFilter ? 'secondary' : 'default'}
                  onClick={() => setFilter('')}
                >
                  {t('project.communication.filter.all', { defaultValue: 'All project messages' })}
                </Button>
                {streamOptions.map((stream) => (
                  <Button
                    key={stream}
                    size="sm"
                    variant={streamFilter === stream ? 'default' : 'secondary'}
                    onClick={() => setFilter(stream)}
                  >
                    {t('project.communication.filter.stream', {
                      defaultValue: 'Stream: {{stream}}',
                      stream,
                    })}
                  </Button>
                ))}
              </div>
              <TabsList>
                <TabsTrigger value="pending">
                  {t('project.communication.tabs.pending')}
                  {pendingRows.length > 0 ? ` (${pendingRows.length})` : ''}
                </TabsTrigger>
                <TabsTrigger value="updates">{t('project.messages.tabs.updates')}</TabsTrigger>
                <TabsTrigger value="resolved">{t('project.communication.tabs.resolved')}</TabsTrigger>
              </TabsList>
              <TabsContent value="pending" className="mt-4">
                {pendingRows.length === 0 ? (
                  <p className="text-sm text-text-muted">
                    {t('project.messages.empty.decisions')}
                  </p>
                ) : (
                  <WorkforceDecisionList messages={pendingRows} onRefresh={load} />
                )}
              </TabsContent>
              <TabsContent value="updates" className="mt-4">
                <MessageList rows={updateRows} empty={t('project.messages.empty.updates')} />
              </TabsContent>
              <TabsContent value="resolved" className="mt-4">
                <MessageList
                  rows={resolvedRows}
                  empty={t('project.communication.emptyResolved')}
                />
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>
    </ProjectShell>
  )
}
