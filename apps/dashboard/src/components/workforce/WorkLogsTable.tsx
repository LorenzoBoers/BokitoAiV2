import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Card } from '../ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table'
import type { ProjectRow } from '../../lib/projects-api'
import type { WorkLogRow } from '../../lib/work-logs-api'
import { formatWorkLogWhen, projectNameForRun } from '../../lib/work-logs-format'

type WorkLogsTableProps = {
  runs: WorkLogRow[]
  projects: ProjectRow[]
  runTo: (run: WorkLogRow) => string
  showProjectColumn?: boolean
}

export function WorkLogsTable({
  runs,
  projects,
  runTo,
  showProjectColumn = true,
}: WorkLogsTableProps) {
  const { t } = useTranslation('nav')

  return (
    <Card className="overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('workforce.runs.columns.subject')}</TableHead>
            {showProjectColumn ? (
              <TableHead>{t('workforce.runs.columns.project')}</TableHead>
            ) : null}
            <TableHead>{t('workforce.runs.columns.status')}</TableHead>
            <TableHead>{t('workforce.runs.columns.started')}</TableHead>
            <TableHead>{t('workforce.runs.columns.tokens')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => (
            <TableRow key={run.id}>
              <TableCell>
                <Link to={runTo(run)} className="font-medium text-accent hover:underline">
                  {run.task_subject || t('workforce.runs.fallbackSubject')}
                </Link>
              </TableCell>
              {showProjectColumn ? (
                <TableCell className="text-text-muted">
                  {projectNameForRun(projects, run.project_id)}
                </TableCell>
              ) : null}
              <TableCell>{run.status}</TableCell>
              <TableCell className="text-text-muted">{formatWorkLogWhen(run.started_at)}</TableCell>
              <TableCell className="text-text-muted">{run.tokens_used ?? 0}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  )
}
