import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, Check, MoreHorizontal, X } from 'lucide-react'
import type { LearnChoice } from '../../lib/agent-rules-api'
import type { MessageProposal, ProposalBundleEntry, ThreadId } from '../../lib/inbox-api'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { actionTitle, useDecisionResolve } from './useDecisionResolve'

type RowState = 'awaiting_human' | 'approved' | 'rejected' | 'deferred' | 'failed' | 'missing'

/** Operator label for one action row: `actions.{tool}` in the UI language, else the server title. */
export function useActionLabel() {
  const { t, i18n } = useTranslation('communication')
  return (entry: ProposalBundleEntry): string => {
    const action = entry.action
    if (action) {
      const key = action.args.new_name && action.key === 'update_tag' ? 'actions.update_tag_rename' : `actions.${action.key}`
      if (i18n.exists(`communication:${key}`)) return t(key, action.args)
      if (action.fallback) return action.fallback
    }
    return actionTitle(entry.title)
  }
}

function rowState(entry: ProposalBundleEntry, local: Record<string, RowState>): RowState {
  const override = local[entry.decisionId]
  if (override) return override
  if (entry.status === 'awaiting_human' || entry.status === 'pending') return 'awaiting_human'
  if (entry.status === 'approved' || entry.status === 'rejected' || entry.status === 'deferred') return entry.status
  return 'missing'
}

/**
 * One card for every action an agent asked approval for in one turn. Each row
 * is one tool call; the operator approves all, a selection, or none, and can
 * teach the agent per action: only now, always, always ask, or never.
 */
export function ActionBundleCard({
  proposal,
  threadId,
  agentName,
  onResolved,
}: {
  proposal: MessageProposal
  threadId: ThreadId
  agentName?: string | null
  onResolved?: (info?: { closed?: boolean }) => void
}) {
  const { t } = useTranslation('communication')
  const label = useActionLabel()
  const entries = proposal.bundle
  const [local, setLocal] = useState<Record<string, RowState>>({})
  const [taught, setTaught] = useState<Record<string, LearnChoice>>({})
  const [picked, setPicked] = useState<string[]>([])
  const { busy, error, learnBusy, resolveBundle, teachEntry } = useDecisionResolve({
    threadId,
    cardMessageId: proposal.cardMessageId,
    decisionId: proposal.decisionId,
    resolved: false,
    onResolved,
  })

  const states = useMemo(
    () => Object.fromEntries(entries.map((e) => [e.decisionId, rowState(e, local)])) as Record<string, RowState>,
    [entries, local],
  )
  const open = entries.filter((e) => states[e.decisionId] === 'awaiting_human')
  const multi = entries.length > 1
  const allDone = open.length === 0
  const approvedCount = entries.filter((e) => states[e.decisionId] === 'approved').length
  const rejectedCount = entries.filter((e) => states[e.decisionId] === 'rejected').length
  const selected = picked.filter((id) => open.some((e) => e.decisionId === id))

  function applyRows(rows: { decisionId: string; status: string; error: string | null; skipped: boolean }[]) {
    if (!rows.length) return
    setLocal((prev) => {
      const next = { ...prev }
      for (const row of rows) {
        if (row.error) next[row.decisionId] = 'failed'
        else if (row.status === 'approved' || row.status === 'rejected' || row.status === 'deferred') {
          next[row.decisionId] = row.status
        }
      }
      return next
    })
    setPicked([])
  }

  async function approveIds(ids: string[] | 'all', reject: 'rest' | string[] = []) {
    applyRows(await resolveBundle(open, ids, reject))
  }

  async function rejectRemaining() {
    applyRows(await resolveBundle(open, [], 'rest'))
  }

  async function teachRow(entry: ProposalBundleEntry, choice: LearnChoice) {
    const result = await teachEntry(entry, choice)
    if (!result) return
    setTaught((prev) => ({ ...prev, [entry.decisionId]: choice }))
    if (states[entry.decisionId] !== 'awaiting_human') return
    // The verdict also settles this row: allow runs it now, deny leaves it undone.
    if (choice === 'allow') await approveIds([entry.decisionId])
    if (choice === 'deny') applyRows(await resolveBundle(open, [], [entry.decisionId]))
  }

  const agent = agentName || t('timeline.aiAgent')

  return (
    <div
      className="rounded-xl border border-border bg-bg-surface/70 px-3 py-2 text-sm"
      data-testid="action-bundle"
    >
      <p className="mb-1.5 text-xs text-text-muted" data-testid="action-bundle-header">
        {allDone
          ? t('actionBundle.summary', { approved: approvedCount, rejected: rejectedCount })
          : t('actionBundle.header', { count: open.length })}
      </p>
      <ul className="divide-y divide-border/60">
        {entries.map((entry) => {
          const state = states[entry.decisionId]
          const isOpen = state === 'awaiting_human'
          const checked = selected.includes(entry.decisionId)
          const learned = taught[entry.decisionId]
          return (
            <li
              key={entry.decisionId}
              className="flex items-center gap-2 py-1.5"
              data-testid="action-bundle-row"
              data-state={state}
            >
              {multi && isOpen ? (
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={busy}
                  aria-label={t('actionBundle.selectRow')}
                  onChange={(e) =>
                    setPicked((prev) =>
                      e.target.checked
                        ? [...prev, entry.decisionId]
                        : prev.filter((id) => id !== entry.decisionId),
                    )
                  }
                  className="h-3.5 w-3.5 shrink-0 rounded border-border accent-accent"
                />
              ) : (
                <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-text-muted">
                  {state === 'approved' ? (
                    <Check size={13} aria-hidden className="text-status-success" />
                  ) : state === 'rejected' ? (
                    <X size={13} aria-hidden />
                  ) : state === 'failed' ? (
                    <AlertCircle size={13} aria-hidden className="text-status-error" />
                  ) : null}
                </span>
              )}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className={cn('truncate', !isOpen && 'text-text-secondary')}>{label(entry)}</span>
                {entry.action?.tool ? (
                  <span className="truncate font-mono text-2xs text-text-muted">{entry.action.tool}</span>
                ) : null}
              </span>
              {!isOpen ? (
                <span className="sr-only">{t(`actionBundle.status.${state}`)}</span>
              ) : null}
              {learned ? (
                <span className="shrink-0 text-xs text-text-muted">{t(`actionBundle.taught.${learned}`)}</span>
              ) : null}
              {entry.learn || isOpen ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      size="iconSm"
                      variant="ghost"
                      aria-label={t('actionBundle.rowMenu')}
                      disabled={busy || learnBusy}
                      data-testid="action-bundle-row-menu"
                    >
                      <MoreHorizontal size={14} aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {isOpen ? (
                      <>
                        <DropdownMenuItem onSelect={() => void approveIds([entry.decisionId])}>
                          {t('actionBundle.once')}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => void resolveBundle(open, [], [entry.decisionId]).then(applyRows)}
                        >
                          {t('actionBundle.rejectOne')}
                        </DropdownMenuItem>
                      </>
                    ) : null}
                    {entry.learn ? (
                      <>
                        {isOpen ? <DropdownMenuSeparator /> : null}
                        <DropdownMenuLabel className="text-2xs font-medium text-text-muted">
                          {t('actionBundle.nextTime', { agent })}
                        </DropdownMenuLabel>
                        <DropdownMenuItem disabled={!!learned} onSelect={() => void teachRow(entry, 'allow')}>
                          {t('actionBundle.always', { agent })}
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={!!learned} onSelect={() => void teachRow(entry, 'ask')}>
                          {t('actionBundle.alwaysAsk')}
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={!!learned} onSelect={() => void teachRow(entry, 'deny')}>
                          {t('actionBundle.deny')}
                        </DropdownMenuItem>
                      </>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </li>
          )
        })}
      </ul>
      {!allDone ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5" data-testid="action-bundle-footer">
          <Button type="button" size="sm" variant="ai" disabled={busy} onClick={() => void approveIds('all', 'rest')}>
            {open.length > 1 ? t('actionBundle.approveAll') : t('actionBundle.approve')}
          </Button>
          {multi && selected.length > 0 && selected.length < open.length ? (
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void approveIds(selected)}>
              {t('actionBundle.approveSelected', { count: selected.length })}
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void rejectRemaining()}>
            {multi && open.length < entries.length ? t('actionBundle.rejectRest') : t('actionBundle.reject')}
          </Button>
        </div>
      ) : null}
      {error ? <p className="mt-1 text-xs text-status-error">{error}</p> : null}
    </div>
  )
}

export default ActionBundleCard
