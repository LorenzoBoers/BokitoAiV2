import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { patchWorkstream, type WorkstreamRow } from '../../lib/flows-api'
import { getSignalPolicy, type StageEntryPolicy } from '../../lib/tickets-api'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'

const POLICIES: StageEntryPolicy[] = ['propose', 'auto_above', 'first_stage']
const THRESHOLDS = [5, 6, 7, 8, 9, 10]
const DEFAULT = 'workspace'

/** What happens when an agent moves one of this flow's tickets. Empty follows the workspace. */
export function FlowStageEntryControl({
  flow,
  canEdit,
  onSaved,
}: {
  flow: WorkstreamRow
  canEdit: boolean
  onSaved: (updated: WorkstreamRow) => void
}) {
  const { t } = useTranslation('nav')
  const [workspace, setWorkspace] = useState<{ policy: StageEntryPolicy; threshold: number } | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    void getSignalPolicy()
      .then((row) => alive && setWorkspace({ policy: row.stage_entry_policy, threshold: row.stage_entry_threshold }))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  const own = (flow.stage_entry_policy || '') as StageEntryPolicy | ''
  const effective = own || workspace?.policy || 'propose'
  const threshold = flow.stage_entry_threshold ?? workspace?.threshold ?? 8

  const save = async (patch: { stage_entry_policy?: string; stage_entry_threshold?: number }) => {
    setSaving(true)
    try {
      onSaved(await patchWorkstream(flow.id, patch))
      toast.success(t('workstreamsPage.stages.entrySaved'))
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('workstreamsPage.stages.entrySaveError')))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="inline-flex items-center gap-2 text-text-secondary" title={t('workstreamsPage.stages.entryHint')}>
      <span className="font-medium">{t('workstreamsPage.stages.entry')}</span>
      <Select
        value={own || DEFAULT}
        disabled={!canEdit || saving}
        onValueChange={(value) => void save({ stage_entry_policy: value === DEFAULT ? '' : value })}
      >
        <SelectTrigger className="h-7 w-auto min-w-[12rem] text-xs" aria-label={t('workstreamsPage.stages.entry')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT}>
            {t('workstreamsPage.stages.entryDefault', {
              policy: t(`workstreamsPage.stages.entryPolicies.${workspace?.policy ?? 'propose'}`),
            })}
          </SelectItem>
          {POLICIES.map((policy) => (
            <SelectItem key={policy} value={policy}>
              {t(`workstreamsPage.stages.entryPolicies.${policy}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {effective === 'auto_above' ? (
        <>
          <span className="text-text-muted">{t('workstreamsPage.stages.entryThreshold')}</span>
          <Select
            value={String(threshold)}
            disabled={!canEdit || saving}
            onValueChange={(value) => void save({ stage_entry_threshold: Number(value) })}
          >
            <SelectTrigger className="h-7 w-16 text-xs" aria-label={t('workstreamsPage.stages.entryThreshold')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(THRESHOLDS.includes(threshold) ? THRESHOLDS : [...THRESHOLDS, threshold].sort((a, b) => a - b)).map(
                (value) => (
                  <SelectItem key={value} value={String(value)}>
                    {value}/10
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </>
      ) : null}
    </div>
  )
}
