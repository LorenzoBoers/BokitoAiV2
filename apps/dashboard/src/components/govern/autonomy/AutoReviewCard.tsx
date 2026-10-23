import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ScanEye, ScrollText } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../../ui/button'
import { Card } from '../../ui/card'
import { SettingsFieldsSkeleton } from '../../ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select'
import { Textarea } from '../../ui/textarea'
import { getAutoReview, setAutoReview, type AutoReviewMode, type AutoReviewState } from '../../../lib/govern-api'
import { SectionHeading, SettingRow } from './SettingRow'

/** Govern > Policy: the auto-reviewer that looks at an action before a human is asked. */
export function AutoReviewCard({ canEdit }: { canEdit: boolean }) {
  const { t } = useTranslation('nav')
  const [state, setState] = useState<AutoReviewState | null>(null)
  const [instructions, setInstructions] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    void getAutoReview()
      .then((data) => {
        if (cancelled) return
        setState(data)
        setInstructions(data.instructions)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const save = async (mode: AutoReviewMode, nextInstructions: string) => {
    setSaving(true)
    try {
      const data = await setAutoReview({ mode, instructions: nextInstructions })
      setState(data)
      setInstructions(data.instructions)
      toast.success(t('ai.autoReview.saved'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('ai.autoReview.saveError'))
    } finally {
      setSaving(false)
    }
  }

  const agreement =
    state && state.agreement_sample > 0 && state.agreement_rate != null
      ? t('ai.autoReview.agreement', { rate: state.agreement_rate, count: state.agreement_sample })
      : t('ai.autoReview.agreementEmpty')

  return (
    <Card className="space-y-5 p-5" data-testid="govern-auto-review">
      <SectionHeading title={t('ai.autoReview.title')} description={t('ai.autoReview.description')} />
      {!state ? (
        <SettingsFieldsSkeleton rows={2} />
      ) : (
        <div className="space-y-5">
          <SettingRow
            first
            icon={ScanEye}
            htmlFor="auto-review-mode"
            label={t('ai.autoReview.modeLabel')}
            hint={t(`ai.autoReview.modeHints.${state.mode}`)}
          >
            <Select
              value={state.mode}
              disabled={!canEdit || saving}
              onValueChange={(value) => void save(value as AutoReviewMode, instructions)}
            >
              <SelectTrigger id="auto-review-mode" className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {state.modes.map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {t(`ai.autoReview.modes.${mode}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>
          <SettingRow
            icon={ScrollText}
            htmlFor="auto-review-instructions"
            label={t('ai.autoReview.instructionsLabel')}
            hint={t('ai.autoReview.instructionsHint')}
          >
            <div className="w-72 space-y-2">
              <Textarea
                id="auto-review-instructions"
                rows={4}
                maxLength={2000}
                value={instructions}
                disabled={!canEdit || saving}
                placeholder={t('ai.autoReview.instructionsPlaceholder')}
                onChange={(e) => setInstructions(e.target.value)}
              />
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!canEdit || saving || instructions === state.instructions}
                  onClick={() => void save(state.mode, instructions)}
                >
                  {t('ai.autoReview.saveInstructions')}
                </Button>
              </div>
            </div>
          </SettingRow>
          <p className="border-t border-border pt-4 text-xs text-text-muted" data-testid="auto-review-agreement">
            {agreement}
          </p>
        </div>
      )}
    </Card>
  )
}
