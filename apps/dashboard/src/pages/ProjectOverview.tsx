import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowUpRight } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { ProjectShell } from '../components/project/ProjectShell'
import { useProjectContext } from '../context/ProjectContext'
import { listMessages, type MessageRow } from '../lib/messages-api'

export default function ProjectOverview() {
  const { t } = useTranslation('nav')
  const { projectId } = useProjectContext()
  const [updates, setUpdates] = useState<MessageRow[]>([])
  const [loadingMessages, setLoadingMessages] = useState(true)

  useEffect(() => {
    setLoadingMessages(true)
    listMessages({ message_type: 'status_update', project_id: projectId })
      .then((rows) => setUpdates(rows.slice(0, 3)))
      .catch(() => setUpdates([]))
      .finally(() => setLoadingMessages(false))
  }, [projectId])

  return (
    <ProjectShell>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>{t('project.overview.title')}</CardTitle>
            <p className="mt-1 text-sm text-text-muted">
              {t('project.overview.description')}
            </p>
          </div>
          <Link
            to={`/project/${projectId}/messages`}
            className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
          >
            {t('project.overview.viewAll')}
            <ArrowUpRight size={12} />
          </Link>
        </CardHeader>
        <CardContent>
          {loadingMessages ? (
            <p className="text-sm text-text-muted">{t('project.overview.loading')}</p>
          ) : updates.length === 0 ? (
            <p className="text-sm text-text-muted">{t('project.overview.empty')}</p>
          ) : (
            <ul className="space-y-3">
              {updates.map((msg) => (
                <li
                  key={msg.id}
                  className="rounded-xl border border-border/70 bg-bg-elevated px-4 py-3"
                >
                  {msg.subject ? (
                    <p className="text-sm font-medium text-text-primary">{msg.subject}</p>
                  ) : null}
                  <p className="mt-1 whitespace-pre-wrap text-sm text-text-secondary">
                    {msg.body}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </ProjectShell>
  )
}
