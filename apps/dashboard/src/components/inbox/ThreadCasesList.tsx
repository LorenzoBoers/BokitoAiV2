import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  createCase,
  listCaseTypes,
  listCasesForSignal,
  patchCase,
  type CaseRow,
  type CaseStatus,
  type CaseTypeRow,
} from '../../lib/cases-api'
import { toast } from 'sonner'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { workstreamPath } from '../../lib/workstream-ui'
import { Link } from 'react-router-dom'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { Plus } from 'lucide-react'
import { signalTypeLabel } from '../../lib/signal-type-catalog'
import { cn } from '../../lib/utils'

type Props = {
  signalId: string
}

/** Accepted signals read as three states; `proposed` gets the confirm chip. */
type Lifecycle = 'open' | 'waiting' | 'done'

const LIFECYCLES: Lifecycle[] = ['open', 'waiting', 'done']

const LIFECYCLE_FALLBACK: Record<Lifecycle, string> = {
  open: 'Open',
  waiting: 'Waiting',
  done: 'Done',
}

function operatorLifecycle(status: CaseStatus): Lifecycle {
  return status === 'waiting' || status === 'done' ? status : 'open'
}

function isLabelOnly(row: CaseRow): boolean {
  return (row.case_type?.follow_up_mode ?? 'track') === 'label'
}

function isActiveQueue(row: CaseRow): boolean {
  if (isLabelOnly(row)) return false
  return row.status !== 'done' && row.status !== 'proposed'
}

export function ThreadCasesList({ signalId }: Props) {
  const { t, i18n } = useTranslation('nav')
  const [rows, setRows] = useState<CaseRow[]>([])
  const [types, setTypes] = useState<CaseTypeRow[]>([])
  const [busy, setBusy] = useState(false)
  const typeLabel = (type: { slug?: string | null; name?: string | null } | null | undefined) =>
    signalTypeLabel(type, i18n.language)

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

  /** One place for the write + reload, so a refused accept surfaces as a toast. */
  const run = async (fn: () => Promise<unknown>, fallback: string) => {
    setBusy(true)
    try {
      await fn()
      await load()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, fallback))
    } finally {
      setBusy(false)
    }
  }

  const add = (typeId: string) =>
    run(
      () => createCase({ case_type_id: typeId, signal_id: signalId }),
      t('cases.addError', { defaultValue: 'Could not add that signal.' }),
    )

  const setLifecycle = (caseId: string, next: Lifecycle) =>
    run(
      () => patchCase(caseId, { status: next }),
      next === 'open'
        ? t('cases.acceptError', { defaultValue: 'Could not accept this signal.' })
        : t('cases.updateError', { defaultValue: 'Could not update this signal.' }),
    )

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
          {t('cases.listTitle', { defaultValue: 'Signals' })}
        </p>
        {types.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                className="h-7 gap-1 px-2 text-[11px]"
              >
                <Plus size={12} />
                {t('cases.addMissed', { defaultValue: 'Add a signal' })}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-64 overflow-y-auto">
              {types.map((type) => (
                <DropdownMenuItem
                  key={type.id}
                  disabled={busy}
                  onSelect={() => void add(type.id)}
                  title={
                    type.follow_up_mode === 'label'
                      ? t('cases.addLabelHint', {
                          defaultValue: 'Stamps the thread; does not open a queue item.',
                        })
                      : type.description || undefined
                  }
                >
                  {typeLabel(type)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Link
            to="/settings/signals"
            className="shrink-0 text-[10.5px] font-medium text-accent hover:underline"
          >
            {t('cases.manageTypes', { defaultValue: 'Set up signal types' })}
          </Link>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-text-muted">
          {t('cases.emptyThread', {
            defaultValue:
              'No signals yet. Add one — for example Invoice / payment on a dunning email.',
          })}
        </p>
      ) : (
        <ul className="space-y-1">
          {rows.map((row) => {
            const labelOnly = isLabelOnly(row)
            const active = isActiveQueue(row)
            const proposed = row.status === 'proposed'
            const caseTypeName = typeLabel(row.case_type)
            return (
              <li
                key={row.id}
                className={cn(
                  'rounded-lg border px-2.5 py-1.5',
                  proposed
                    ? 'border-status-warning/50 bg-status-warning/5'
                    : active
                      ? 'border-accent/40 bg-accent/5'
                      : 'border-border/50',
                )}
              >
                <p className="truncate text-[12px] font-medium text-text-primary">
                  {row.title || caseTypeName}
                </p>
                {proposed ? (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="text-[10.5px] text-text-muted">
                      {t('cases.confirmChip', {
                        defaultValue: 'Looks like {{type}} — confirm?',
                        type: caseTypeName || t('cases.listTitle', { defaultValue: 'Signal' }),
                      })}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy}
                      className="h-6 px-2 text-[10.5px]"
                      onClick={() => void setLifecycle(row.id, 'open')}
                    >
                      {t('cases.confirm', { defaultValue: 'Confirm' })}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      className="h-6 px-2 text-[10.5px]"
                      onClick={() => void setLifecycle(row.id, 'done')}
                    >
                      {t('cases.dismiss', { defaultValue: 'Dismiss' })}
                    </Button>
                  </div>
                ) : (
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10.5px] text-text-muted">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          disabled={busy}
                          className={cn(
                            'inline-flex items-center rounded-md border px-1.5 py-0 text-[10px]',
                            active ? 'border-accent/50 text-accent' : 'border-border',
                          )}
                        >
                          {t(`cases.lifecycle.${operatorLifecycle(row.status)}`, {
                            defaultValue: LIFECYCLE_FALLBACK[operatorLifecycle(row.status)],
                          })}
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        {LIFECYCLES.map((life) => (
                          <DropdownMenuItem
                            key={life}
                            disabled={busy || operatorLifecycle(row.status) === life}
                            onSelect={() => void setLifecycle(row.id, life)}
                          >
                            {t(`cases.lifecycle.${life}`, { defaultValue: LIFECYCLE_FALLBACK[life] })}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    {labelOnly ? (
                      <Badge variant="outline" className="px-1.5 py-0 text-[10px] text-text-muted">
                        {t('cases.labelChip', { defaultValue: 'Label' })}
                      </Badge>
                    ) : null}
                    {caseTypeName ? <span>{caseTypeName}</span> : null}
                    {row.workstream_id ? (
                      <Link
                        to={workstreamPath(row.workstream_id)}
                        className="text-accent hover:underline"
                      >
                        {t('cases.openWorkstream', { defaultValue: 'Playbook' })}
                      </Link>
                    ) : null}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
