import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createCase, listCaseTypes, listCasesForSignal, type CaseRow, type CaseTypeRow } from '../../lib/cases-api'
import { workstreamPath } from '../../lib/workstream-ui'
import { Link } from 'react-router-dom'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'

type Props = {
  signalId: string
}

function statusLabel(
  status: string,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  return t(`casesPage.statuses.${status}`, {
    defaultValue: status.replace(/_/g, ' '),
  })
}

export function ThreadCasesList({ signalId }: Props) {
  const { t } = useTranslation('nav')
  const [rows, setRows] = useState<CaseRow[]>([])
  const [types, setTypes] = useState<CaseTypeRow[]>([])
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [cases, typeRows] = await Promise.all([
      listCasesForSignal(signalId).catch(() => []),
      listCaseTypes().catch(() => []),
    ])
    setRows(cases)
    setTypes(typeRows.filter((row) => row.enabled))
  }, [signalId])

  useEffect(() => {
    void load()
  }, [load])

  const add = async (typeId: string) => {
    setBusy(true)
    try {
      await createCase({ case_type_id: typeId, signal_id: signalId })
      await load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
          {t('cases.listTitle', { defaultValue: 'Cases' })}
        </p>
        <Link
          to="/cases"
          className="shrink-0 text-[10.5px] font-medium text-accent hover:underline"
        >
          {t('cases.openHub', { defaultValue: 'All cases' })}
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-text-muted">
          {t('cases.emptyThread', { defaultValue: 'No cases on this conversation yet.' })}
        </p>
      ) : (
        <ul className="space-y-1">
          {rows.map((row) => (
            <li
              key={row.id}
              className="rounded-lg border border-border/50 px-2.5 py-1.5"
            >
              <p className="truncate text-[12px] font-medium text-text-primary">
                {row.title || row.case_type?.name}
              </p>
              <p className="flex flex-wrap items-center gap-1.5 text-[10.5px] text-text-muted">
                <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                  {statusLabel(row.status, t)}
                </Badge>
                {row.case_type?.name ? <span>{row.case_type.name}</span> : null}
                {row.workstream_id ? (
                  <Link to={workstreamPath(row.workstream_id)} className="text-accent hover:underline">
                    {t('cases.openWorkstream', { defaultValue: 'Workstream' })}
                  </Link>
                ) : null}
              </p>
            </li>
          ))}
        </ul>
      )}
      {types.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {types.slice(0, 6).map((type) => (
            <Button
              key={type.id}
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              className="h-7 px-2 text-[11px]"
              onClick={() => void add(type.id)}
            >
              {t('cases.addType', { defaultValue: 'Add {{name}}', name: type.name })}
            </Button>
          ))}
        </div>
      ) : (
        <Link
          to="/cases?tab=types"
          className="inline-flex text-[11px] font-medium text-accent hover:underline"
        >
          {t('cases.manageTypes', { defaultValue: 'Set up case types' })}
        </Link>
      )}
    </div>
  )
}
