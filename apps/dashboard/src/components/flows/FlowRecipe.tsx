import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ListChecks } from 'lucide-react'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { patchWorkstream, type WorkstreamDetail } from '../../lib/flows-api'

const FIELD_CLASS =
  'w-full resize-y rounded-md border border-border bg-transparent px-2 py-1 text-sm leading-relaxed text-text-secondary outline-none placeholder:text-text-muted hover:border-border focus:border-border focus:bg-bg-input/60 focus:ring-1 focus:ring-border/60'

/** The flow as a recipe: how the agent works on its label's conversations and what done produces. */
export function FlowRecipe({
  flow,
  canEdit,
  onSaved,
}: {
  flow: WorkstreamDetail
  canEdit: boolean
  onSaved: (updated: WorkstreamDetail) => void
}) {
  const { t } = useTranslation('nav')
  const [instructions, setInstructions] = useState(flow.instructions ?? '')
  const [outcome, setOutcome] = useState(flow.expected_outcome ?? '')
  const [saving, setSaving] = useState(false)

  useEffect(() => setInstructions(flow.instructions ?? ''), [flow.instructions])
  useEffect(() => setOutcome(flow.expected_outcome ?? ''), [flow.expected_outcome])

  const save = async (patch: Parameters<typeof patchWorkstream>[1]) => {
    setSaving(true)
    try {
      onSaved(await patchWorkstream(flow.id, patch))
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('workstreamsPage.recipe.saveError')))
    } finally {
      setSaving(false)
    }
  }

  if (!canEdit && !flow.instructions && !flow.expected_outcome) return null

  return (
    <section className="flex max-w-2xl flex-col gap-2 text-xs text-text-secondary" data-testid="flow-recipe">
      <div className="flex items-center gap-2">
        <ListChecks size={14} className="shrink-0 text-text-muted" aria-hidden />
        <span className="shrink-0 font-medium">{t('workstreamsPage.recipe.done')}</span>
        {canEdit ? (
          <input
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            onBlur={() => {
              if (outcome.trim() !== (flow.expected_outcome ?? '')) void save({ expected_outcome: outcome })
            }}
            placeholder={t('workstreamsPage.recipe.donePlaceholder')}
            aria-label={t('workstreamsPage.recipe.done')}
            disabled={saving}
            maxLength={500}
            className={FIELD_CLASS}
          />
        ) : (
          <span className="text-text-primary">{flow.expected_outcome}</span>
        )}
      </div>
      {canEdit ? (
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          onBlur={() => {
            if (instructions.trim() !== (flow.instructions ?? '')) void save({ instructions })
          }}
          placeholder={t('workstreamsPage.recipe.instructionsPlaceholder')}
          aria-label={t('workstreamsPage.recipe.instructions')}
          disabled={saving}
          rows={instructions ? 3 : 1}
          className={FIELD_CLASS}
        />
      ) : flow.instructions ? (
        <p className="whitespace-pre-line text-sm text-text-secondary">{flow.instructions}</p>
      ) : null}
      {flow.capabilities?.length ? (
        <p className="text-text-muted">
          {t('workstreamsPage.recipe.uses')}: {flow.capabilities.join(', ')}
        </p>
      ) : null}
    </section>
  )
}
