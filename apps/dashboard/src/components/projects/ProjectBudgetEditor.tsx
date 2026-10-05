import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { formatAppNumber } from '../../lib/app-number'
import { patchProject, type ProjectBudgetResponse } from '../../lib/projects-api'
import { ProjectBudgetBar } from './ProjectBudgetBar'

export function ProjectBudgetEditor({
  projectId,
  budget,
  canEdit,
  onChanged,
  editOpen,
  onEditOpenChange,
}: {
  projectId: string
  budget: ProjectBudgetResponse | null
  canEdit: boolean
  onChanged: () => Promise<void>
  editOpen?: boolean
  onEditOpenChange?: (open: boolean) => void
}) {
  const { t, i18n } = useTranslation('nav')
  const { t: tc } = useTranslation('common')
  const [internalOpen, setInternalOpen] = useState(false)
  const open = editOpen ?? internalOpen
  const setOpen = onEditOpenChange ?? setInternalOpen
  const [daily, setDaily] = useState('')
  const [hourly, setHourly] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!budget) return
    setDaily(budget.token_budget_daily_set != null ? String(budget.token_budget_daily_set) : '')
    setHourly(budget.token_budget_hourly_set != null ? String(budget.token_budget_hourly_set) : '')
  }, [budget, open])

  const save = async () => {
    setSaving(true)
    try {
      const dailyValue = daily.trim() === '' ? null : Number(daily)
      const hourlyValue = hourly.trim() === '' ? null : Number(hourly)
      if (
        (dailyValue != null && (!Number.isFinite(dailyValue) || dailyValue < 0)) ||
        (hourlyValue != null && (!Number.isFinite(hourlyValue) || hourlyValue < 0))
      ) {
        toast.error(t('projects.detail.budgetMustBeNumber'))
        return
      }
      await patchProject(projectId, {
        token_budget_daily: dailyValue == null ? null : Math.round(dailyValue),
        token_budget_hourly: hourlyValue == null ? null : Math.round(hourlyValue),
      })
      toast.success(t('projects.detail.budgetSaved'))
      setOpen(false)
      await onChanged()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('projects.detail.budgetSaveError')))
    } finally {
      setSaving(false)
    }
  }

  if (!budget) {
    return <p className="text-sm text-text-muted">{t('projects.detail.noBudget')}</p>
  }

  const workspaceLabel =
    budget.workspace_daily_cap != null
      ? formatAppNumber(budget.workspace_daily_cap, i18n.language)
      : t('projects.detail.budgetInherit')

  return (
    <>
      <div className="space-y-3">
        <ProjectBudgetBar budget={budget} />
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-text-muted">{t('projects.detail.remainingToday')}</p>
            <p className="font-medium text-text-heading">
              {formatAppNumber(budget.remaining_today, i18n.language)} {t('projects.detail.tokensUnit')}
            </p>
          </div>
          <div>
            <p className="text-xs text-text-muted">{t('projects.detail.remainingHour')}</p>
            <p className="font-medium text-text-heading">
              {formatAppNumber(budget.remaining_hour, i18n.language)} {t('projects.detail.tokensUnit')}
            </p>
          </div>
        </div>
      </div>

      {canEdit ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{t('projects.detail.editBudgetTitle')}</DialogTitle>
              <DialogDescription>{t('projects.detail.budgetCapHint')}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="project-budget-daily" className="text-xs text-text-muted">
                  {t('projects.detail.budgetDaily')}
                </Label>
                <Input
                  id="project-budget-daily"
                  inputMode="numeric"
                  value={daily}
                  onChange={(e) => setDaily(e.target.value)}
                  placeholder={workspaceLabel}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="project-budget-hourly" className="text-xs text-text-muted">
                  {t('projects.detail.budgetHourly')}
                </Label>
                <Input
                  id="project-budget-hourly"
                  inputMode="numeric"
                  value={hourly}
                  onChange={(e) => setHourly(e.target.value)}
                  placeholder={t('projects.detail.budgetHourlyPlaceholder')}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
                {tc('actions.cancel')}
              </Button>
              <Button type="button" size="sm" disabled={saving} onClick={() => void save()}>
                {t('projects.detail.saveBudget')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}
