import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowUpRight } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { ProjectShell } from '../components/project/ProjectShell'
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
          <p className="mt-2 whitespace-pre-wrap text-sm text-text-primary">{msg.body}</p>
        </li>
      ))}
    </ul>
  )
}

export default function ProjectMessages() {
  const { t } = useTranslation('nav')
  const { projectId } = useProjectContext()
  const [decisions, setDecisions] = useState<MessageRow[]>([])
  const [updates, setUpdates] = useState<MessageRow[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [decisionRows, updateRows] = await Promise.all([
        listMessages({ message_type: 'decision_request', project_id: projectId }),
        listMessages({ message_type: 'status_update', project_id: projectId }),
      ])
      setDecisions(decisionRows)
      setUpdates(updateRows)
    } catch {
      setDecisions([])
      setUpdates([])
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <ProjectShell>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>{t('project.messages.title')}</CardTitle>
            <p className="mt-1 text-sm text-text-muted">{t('project.messages.description')}</p>
          </div>
          <Link
            to="/messages"
            className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
          >
            {t('project.messages.tenantInbox')}
            <ArrowUpRight size={12} />
          </Link>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-text-muted">{t('project.messages.loading')}</p>
          ) : (
            <Tabs defaultValue="updates">
              <TabsList>
                <TabsTrigger value="updates">{t('project.messages.tabs.updates')}</TabsTrigger>
                <TabsTrigger value="decisions">{t('project.messages.tabs.decisions')}</TabsTrigger>
              </TabsList>
              <TabsContent value="updates" className="mt-4">
                <MessageList rows={updates} empty={t('project.messages.empty.updates')} />
              </TabsContent>
              <TabsContent value="decisions" className="mt-4">
                <MessageList rows={decisions} empty={t('project.messages.empty.decisions')} />
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>
    </ProjectShell>
  )
}
