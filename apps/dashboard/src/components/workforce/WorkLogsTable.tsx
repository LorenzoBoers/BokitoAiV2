import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Copy } from 'lucide-react'
import { Card } from '../ui/card'
import { Input } from '../ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table'
import type { ProjectRow } from '../../lib/projects-api'
import type { WorkLogRow } from '../../lib/work-logs-api'
import { workLogStatusLabel } from '../../lib/status-labels'
import { formatWorkLogSubject } from '../../lib/work-log-labels'
import { formatWorkLogWhen, projectNameForRun } from '../../lib/work-logs-format'
import { formatAppNumber } from '../../lib/app-number'

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
  const { t, i18n } = useTranslation('nav')
  const [query, setQuery] = useState('')

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return runs
    return runs.filter((run) => {
      const hay = `${run.task_subject ?? ''} ${run.status} ${run.id} ${projectNameForRun(projects, run.project_id)}`.toLowerCase()
      return hay.includes(q)
    })
  }, [runs, projects, query])

  return (
    <Card className="overflow-hidden">
      {runs.length > 3 ? (
        <div className="border-b border-border/60 px-3 py-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('workforce.runs.search')}
            className="h-8 text-xs"
            aria-label={t('workforce.runs.search')}
          />
        </div>
      ) : null}
      {runs.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-text-muted">{t('workforce.runs.empty')}</p>
      ) : visible.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-text-muted">{t('workforce.runs.filterEmpty')}</p>
      ) : (
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
              <TableHead className="w-10">
                <span className="sr-only">{t('workforce.runs.copyId')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((run) => (
              <TableRow key={run.id}>
                <TableCell>
                  <Link to={runTo(run)} className="font-medium text-accent hover:underline">
                    {formatWorkLogSubject(run.task_subject, t, t('workforce.runs.fallbackSubject'))}
                  </Link>
                </TableCell>
                {showProjectColumn ? (
                  <TableCell className="text-text-muted">
                    {projectNameForRun(projects, run.project_id)}
                  </TableCell>
                ) : null}
                <TableCell>{workLogStatusLabel(run.status, t)}</TableCell>
                <TableCell className="text-text-muted">{formatWorkLogWhen(run.started_at, i18n.language)}</TableCell>
                <TableCell className="text-text-muted">
                  {formatAppNumber(run.tokens_used ?? 0, i18n.language, { maximumFractionDigits: 0 })}
                </TableCell>
                <TableCell>
                  <button
                    type="button"
                    className="rounded p-1 text-text-muted hover:text-accent"
                    title={t('workforce.runs.copyId')}
                    onClick={() => {
                      void navigator.clipboard.writeText(run.id).then(
                        () => toast.success(t('workforce.runs.idCopied')),
                        () => toast.error(t('workforce.runs.loadError')),
                      )
                    }}
                  >
                    <Copy className="h-3.5 w-3.5" aria-hidden />
                    <span className="sr-only">{t('workforce.runs.copyId')}</span>
                  </button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  )
}
