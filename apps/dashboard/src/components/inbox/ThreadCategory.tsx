import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { ChevronDown, Plus } from 'lucide-react'
import { toast } from 'sonner'
import {
  createCase,
  listCaseTypes,
  listCasesForSignal,
  patchCase,
  STAGE_KIND_DOT,
  type CaseRow,
  type CaseTypeRow,
} from '../../lib/cases-api'
import { signalTypeLabel } from '../../lib/signal-type-catalog'
import { workstreamPath } from '../../lib/workstream-ui'
import { cn } from '../../lib/utils'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'

type Props = {
  signalId: string
  /** Changes when the conversation's category or stage changed elsewhere. */
  version?: string
}

/**
 * The one category of this conversation. A category bound to a playbook makes
 * the conversation a ticket with a stage; otherwise it is a label. Picking
 * another category recategorizes the conversation.
 */
export function ThreadCategory({ signalId, version }: Props) {
  const { t, i18n } = useTranslation('nav')
  const [row, setRow] = useState<CaseRow | null>(null)
  const [types, setTypes] = useState<CaseTypeRow[]>([])
  const [busy, setBusy] = useState(false)
  const typeLabel = (type: { slug?: string | null; name?: string | null } | null | undefined) =>
    signalTypeLabel(type, i18n.language)

  const load = useCallback(async () => {
    const [cases, typeRows] = await Promise.all([
      listCasesForSignal(signalId).catch(() => []),
      listCaseTypes().catch(() => []),
    ])
    setRow(cases[0] ?? null)
    setTypes(typeRows.filter((type) => type.enabled))
  }, [signalId])

  useEffect(() => {
    void load()
  }, [load, version])

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

  const setCategory = (typeId: string) =>
    run(
      () => createCase({ case_type_id: typeId, signal_id: signalId }),
      t('cases.addError', { defaultValue: 'Could not set that category.' }),
    )

  const decide = (accept: boolean) =>
    row
      ? run(
          () => patchCase(row.id, { status: accept ? 'open' : 'done' }),
          t('cases.acceptError', { defaultValue: 'Could not accept this category.' }),
        )
      : undefined

  const moveStage = (stageKey: string) =>
    row
      ? run(
          () => patchCase(row.id, { stage_key: stageKey }),
          t('cases.updateError', { defaultValue: 'Could not update this ticket.' }),
        )
      : undefined

  const proposed = row?.status === 'proposed'
  const categoryName = row ? typeLabel(row.case_type) : ''
  const otherTypes = types.filter((type) => type.id !== row?.case_type_id)

  const picker =
    types.length === 0 ? (
      <Link to="/settings/signals" className="shrink-0 text-2xs font-medium text-accent hover:underline">
        {t('cases.manageTypes', { defaultValue: 'Set up categories' })}
      </Link>
    ) : (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" size="sm" variant="outline" disabled={busy} className="h-7 gap-1 px-2 text-xs">
            {row ? null : <Plus size={12} />}
            {row
              ? t('cases.changeCategory', { defaultValue: 'Change category' })
              : t('cases.addMissed', { defaultValue: 'Set category' })}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-64 overflow-y-auto">
          {otherTypes.map((type) => (
            <DropdownMenuItem
              key={type.id}
              disabled={busy}
              onSelect={() => void setCategory(type.id)}
              title={type.description || undefined}
            >
              {typeLabel(type)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    )

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-text-muted">
          {t('cases.listTitle', { defaultValue: 'Category' })}
        </p>
        {proposed ? null : picker}
      </div>
      {row ? (
        <div
          className={cn(
            'rounded-lg border px-2.5 py-1.5',
            proposed
              ? 'border-status-warning/50 bg-status-warning/5'
              : row.is_ticket && row.status !== 'done'
                ? 'border-accent/40 bg-accent/5'
                : 'border-border/50',
          )}
        >
          {proposed ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-2xs text-text-muted">
                {t('cases.confirmChip', { defaultValue: 'Looks like {{type}} — confirm?', type: categoryName })}
              </span>
              <Button
                type="button"
                size="sm"
                disabled={busy}
                className="h-6 px-2 text-2xs"
                onClick={() => void decide(true)}
              >
                {t('cases.confirm', { defaultValue: 'Confirm' })}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                className="h-6 px-2 text-2xs"
                onClick={() => void decide(false)}
              >
                {t('cases.dismiss', { defaultValue: 'Dismiss' })}
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5 text-2xs text-text-muted">
              <span className="text-xs font-medium text-text-primary">{categoryName}</span>
              {row.is_ticket ? (
                <>
                  <Badge variant="outline" className="px-1.5 py-0 text-2xs">
                    {t('cases.ticketChip', { defaultValue: 'Ticket' })}
                  </Badge>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={t('cases.stage', { defaultValue: 'Stage' })}
                        className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0 text-2xs text-text-heading hover:bg-bg-hover/70"
                      >
                        {row.stage ? (
                          <span className={cn('h-1.5 w-1.5 rounded-full', STAGE_KIND_DOT[row.stage.kind])} />
                        ) : null}
                        {row.stage?.name ??
                          t(`cases.lifecycle.${row.status === 'proposed' ? 'open' : row.status}`)}
                        <ChevronDown size={10} className="text-text-muted" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      {(row.stages ?? []).map((stage) => (
                        <DropdownMenuItem
                          key={stage.key}
                          className="gap-2 text-xs"
                          disabled={busy || stage.key === row.stage_key}
                          onSelect={() => void moveStage(stage.key)}
                        >
                          <span className={cn('h-1.5 w-1.5 rounded-full', STAGE_KIND_DOT[stage.kind])} />
                          {stage.name}
                        </DropdownMenuItem>
                      ))}
                      {row.workstream_id ? (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem asChild className="text-xs">
                            <Link to={workstreamPath(row.workstream_id)}>
                              {t('cases.openWorkstream', { defaultValue: 'Playbook' })}
                            </Link>
                          </DropdownMenuItem>
                        </>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {row.current_step_name ? <span>{row.current_step_name}</span> : null}
                </>
              ) : (
                <Badge variant="outline" className="px-1.5 py-0 text-2xs text-text-muted">
                  {t('cases.labelChip', { defaultValue: 'Label' })}
                </Badge>
              )}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
