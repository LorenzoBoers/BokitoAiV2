import { Link, Navigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LiveWorkLog } from '../components/observability/LiveWorkLog'
import { ProjectShell } from '../components/project/ProjectShell'

export default function ProjectWorkforceRunDetail() {
  const { t } = useTranslation('nav')
  const { projectId, workLogId } = useParams<{ projectId: string; workLogId: string }>()

  if (!projectId || !workLogId) {
    return <Navigate to="/os" replace />
  }

  return (
    <ProjectShell>
      <div className="space-y-3">
        <Link
          to={`/project/${projectId}/workforce`}
          className="text-sm text-accent hover:underline"
        >
          {t('workforce.runs.back')}
        </Link>
        <LiveWorkLog workLogId={workLogId} />
      </div>
    </ProjectShell>
  )
}
