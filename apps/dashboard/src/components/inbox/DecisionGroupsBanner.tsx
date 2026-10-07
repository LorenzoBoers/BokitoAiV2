import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Layers } from 'lucide-react'
import {
  bulkDismissCandidates,
  dismissDecisions,
  fetchDecisionGroups,
  type DecisionGroup,
} from '../../lib/decision-groups-api'

type Props = {
  /** Called after cards were dismissed so the thread list can refresh. */
  onDismissed?: (count: number) => void
}

/**
 * Above the "needs decision" list: which kind of card is piling up, with one
 * button to dismiss the whole kind. Only kinds with two or more open cards
 * are shown; single cards are answered inline.
 */
export default function DecisionGroupsBanner({ onDismissed }: Props) {
  const { t } = useTranslation('communication')
  const [groups, setGroups] = useState<DecisionGroup[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setGroups(bulkDismissCandidates(await fetchDecisionGroups()))
    } catch {
      setGroups([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (groups.length === 0) return null

  const dismissGroup = async (group: DecisionGroup) => {
    setBusy(group.title)
    try {
      const count = await dismissDecisions({ title: group.title })
      onDismissed?.(count)
      await load()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="border-b border-border/40 bg-bg-elevated/60 px-3 py-2" data-testid="decision-groups-banner">
      <div className="mb-1 flex items-center gap-1.5 text-2xs font-medium uppercase tracking-wide text-text-muted">
        <Layers size={11} aria-hidden />
        {t('decisionGroups.heading')}
      </div>
      <ul className="flex flex-col gap-1">
        {groups.slice(0, 4).map((group) => (
          <li key={group.title} className="flex items-center gap-2 text-xs">
            <span className="min-w-0 flex-1 truncate-fade text-text-primary" title={group.title}>
              {group.title}
            </span>
            <span className="shrink-0 tabular-nums text-text-muted">{group.count}</span>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void dismissGroup(group)}
              className="shrink-0 rounded-md border border-border/60 px-2 py-0.5 text-2xs font-medium text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:opacity-50"
            >
              {busy === group.title ? t('decisionGroups.dismissing') : t('decisionGroups.dismissAll')}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
