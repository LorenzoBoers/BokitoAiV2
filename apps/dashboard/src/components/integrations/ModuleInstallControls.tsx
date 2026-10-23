import { Checkbox } from '../ui/checkbox'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '../ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import {
  moduleHomePath,
  moduleInstallState,
  moduleIsOn,
} from '../../lib/integration-modules'
import { talkToAssistantPath } from '../../lib/talk-to-assistant'
import {
  getModuleInstallPlan,
  type IntegrationModuleRow,
  type ModuleInstallOptions,
  type ModuleInstallPlan,
} from '../../lib/integrations-api'

type LifecycleAction = 'install' | 'complete_setup' | 'uninstall'

type Props = {
  module: Pick<
    IntegrationModuleRow,
    | 'slug'
    | 'name'
    | 'enabled'
    | 'tenant_status'
    | 'status'
    | 'install_state'
    | 'setup_path'
    | 'assigned_agent_count'
    | 'specialist_agent_id'
    | 'specialist_agent_name'
  >
  onAction: (slug: string, action: LifecycleAction, options?: ModuleInstallOptions) => Promise<unknown>
  /** Compact buttons for cards; default shows primary + secondary. */
  compact?: boolean
  /** Marketplace cards keep install and manage. Uninstall stays on the module page. */
  hideUninstall?: boolean
}

export function ModuleInstallControls({ module, onAction, compact = false, hideUninstall = false }: Props) {
  const { t } = useTranslation(['nav', 'common'])
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [uninstallStep, setUninstallStep] = useState<0 | 1 | 2>(0)
  const [addOpen, setAddOpen] = useState(false)
  const comingSoon = module.status === 'coming_soon'
  const state = moduleInstallState(module)
  const installed = moduleIsOn(module)
  const name = t(`integrations.modules.${module.slug}.name`, {
    defaultValue: module.name || module.slug,
  })

  const run = (action: LifecycleAction, thenNavigate?: string, options?: ModuleInstallOptions) => {
    setBusy(true)
    void onAction(module.slug, action, options)
      .then((result) => {
        const row = (result && typeof result === 'object' ? result : {}) as Partial<IntegrationModuleRow>
        const specialistId = row.specialist_agent_id || module.specialist_agent_id
        const toastKey =
          action === 'install'
            ? 'integrations.modules.installStarted'
            : action === 'complete_setup'
              ? 'integrations.modules.installFinished'
              : 'integrations.modules.uninstalled'
        toast.success(
          t(toastKey, {
            defaultValue:
              action === 'install'
                ? '{{name}} is ready for setup. A specialist was hired onto the roster.'
                : action === 'complete_setup'
                  ? '{{name}} is installed.'
                  : '{{name}} was uninstalled. The managed specialist was archived.',
            name,
          }),
          action === 'install' && specialistId
            ? {
                action: {
                  label: t('integrations.modules.showcase.talkSpecialistShort', {
                    defaultValue: 'Talk to specialist',
                  }),
                  onClick: () =>
                    navigate(
                      talkToAssistantPath(
                        t('integrations.modules.showcase.talkPrefill', {
                          defaultValue:
                            'Help me use {{name}}. What can you do, and what should we set up next?',
                          name,
                        }),
                        specialistId,
                      ),
                    ),
                },
              }
            : undefined,
        )
        if (thenNavigate) navigate(thenNavigate)
      })
      .catch(() => {
        toast.error(
          t('integrations.modules.toggleError', {
            defaultValue: 'Could not update this module.',
          }),
        )
      })
      .finally(() => {
        setBusy(false)
        setUninstallStep(0)
        setAddOpen(false)
      })
  }

  if (comingSoon) {
    return (
      <Button type="button" size="sm" variant="secondary" disabled>
        {t('integrations.modules.comingSoon', { defaultValue: 'Coming soon' })}
      </Button>
    )
  }

  if (state === 'not_installed') {
    return (
      <>
        <Button type="button" size="sm" disabled={busy} onClick={() => setAddOpen(true)}>
          {t('integrations.modules.addDepartment', { defaultValue: 'Add department' })}
        </Button>
        <AddDepartmentDialog
          open={addOpen}
          slug={module.slug}
          name={name}
          busy={busy}
          onOpenChange={setAddOpen}
          onConfirm={(options) => run('install', `${moduleHomePath(module)}?tab=setup`, options)}
        />
      </>
    )
  }

  if (state === 'setup') {
    const hasAgent = (module.assigned_agent_count ?? 0) >= 1
    return (
      <div className={`flex flex-wrap items-center gap-2 ${compact ? '' : ''}`}>
        <Button
          type="button"
          size="sm"
          disabled={busy || !hasAgent}
          title={
            hasAgent
              ? undefined
              : t('integrations.modules.finishSetupNeedsAgent', {
                  defaultValue: 'Assign at least one AI agent before finishing setup',
                })
          }
          onClick={() => run('complete_setup')}
        >
          {t('integrations.modules.finishSetup', { defaultValue: 'Finish setup' })}
        </Button>
        {hideUninstall ? null : (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => setUninstallStep(1)}
        >
          {t('integrations.modules.uninstall', { defaultValue: 'Uninstall' })}
        </Button>
        )}
        <UninstallDialog
          open={uninstallStep > 0}
          step={uninstallStep}
          name={name}
          busy={busy}
          onOpenChange={(open) => setUninstallStep(open ? 1 : 0)}
          onAdvance={() => setUninstallStep(2)}
          onConfirm={() => run('uninstall')}
        />
      </div>
    )
  }

  if (installed && hideUninstall) return null

  return (
    <div className="flex flex-wrap items-center gap-2">
      {installed && !hideUninstall ? (
        <Button
          type="button"
          size="sm"
          variant={compact ? 'destructive' : 'secondary'}
          disabled={busy}
          onClick={() => setUninstallStep(1)}
        >
          {t('integrations.modules.uninstall', { defaultValue: 'Uninstall' })}
        </Button>
      ) : null}
      <UninstallDialog
        open={uninstallStep > 0}
        step={uninstallStep}
        name={name}
        busy={busy}
        onOpenChange={(open) => setUninstallStep(open ? 1 : 0)}
        onAdvance={() => setUninstallStep(2)}
        onConfirm={() => run('uninstall')}
      />
    </div>
  )
}

const NEW_DEPARTMENT = 'new'

/** Install as a department: a new one, or an existing one that already does this work. */
function AddDepartmentDialog({
  open,
  slug,
  name,
  busy,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  slug: string
  name: string
  busy: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (options: ModuleInstallOptions) => void
}) {
  const { t } = useTranslation(['nav', 'common'])
  const [plan, setPlan] = useState<ModuleInstallPlan | null>(null)
  const [failed, setFailed] = useState(false)
  const [target, setTarget] = useState(NEW_DEPARTMENT)
  const [accountable, setAccountable] = useState('')
  const [specialistLeads, setSpecialistLeads] = useState(false)

  useEffect(() => {
    if (!open) return
    let alive = true
    setFailed(false)
    getModuleInstallPlan(slug)
      .then((row) => {
        if (!alive) return
        setPlan(row)
        setTarget(row.suggested_department_id ?? NEW_DEPARTMENT)
        setAccountable(row.default_accountable_user_id ?? '')
      })
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [open, slug])

  const existing = plan?.candidates.find((c) => c.id === target) ?? null
  const ships = plan?.ships
  const select =
    'h-8 w-full rounded-md border border-border bg-bg-input/60 px-2 text-sm text-text-heading outline-none focus:ring-1 focus:ring-border'
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('integrations.modules.addDepartmentTitle', { defaultValue: 'Add {{name}} as a department', name })}</DialogTitle>
          <DialogDescription>
            {t('integrations.modules.addDepartmentBody', {
              defaultValue: 'A module is a department in a box: a specialist agent, labels and flows. Choose where it lands.',
            })}
          </DialogDescription>
        </DialogHeader>
        {failed ? (
          <p className="text-xs text-status-error">{t('integrations.modules.toggleError', { defaultValue: 'Could not update this module.' })}</p>
        ) : !plan ? (
          <p className="text-xs text-text-muted">{t('common:loading', { defaultValue: 'Loading...' })}</p>
        ) : (
          <div className="space-y-3 text-sm" data-testid="add-department-dialog">
            <ul className="space-y-0.5 text-xs text-text-secondary">
              {ships?.specialist ? (
                <li>{t('integrations.modules.shipsSpecialist', { defaultValue: 'Specialist: {{name}}', name: ships.specialist })}</li>
              ) : null}
              {ships?.labels.length ? (
                <li>{t('integrations.modules.shipsLabels', { defaultValue: 'Labels: {{list}}', list: ships.labels.map((l) => l.replace(/^#/, '')).join(', ') })}</li>
              ) : null}
              {ships?.flows.length ? (
                <li>{t('integrations.modules.shipsFlows', { defaultValue: 'Flows: {{list}}', list: ships.flows.join(', ') })}</li>
              ) : null}
            </ul>
            <label className="block space-y-1 text-xs text-text-muted">
              <span>{t('integrations.modules.addDepartmentWhere', { defaultValue: 'Department' })}</span>
              <Select value={target} onValueChange={setTarget}>
                <SelectTrigger className={select}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NEW_DEPARTMENT}>
                    {t('integrations.modules.addDepartmentNew', { defaultValue: 'New department: {{name}}', name })}
                  </SelectItem>
                  {plan.candidates.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.score > 0
                        ? t('integrations.modules.addDepartmentOverlap', { defaultValue: '{{name}} (already does similar work)', name: c.name })
                        : c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="block space-y-1 text-xs text-text-muted">
              <span>{t('integrations.modules.addDepartmentAccountable', { defaultValue: 'Accountable person' })}</span>
              <Select value={accountable} onValueChange={setAccountable}>
                <SelectTrigger className={select}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {plan.people.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            {existing?.lead_name ? (
              <label className="flex items-start gap-2 text-xs text-text-secondary">
                <Checkbox
                  checked={specialistLeads}
                  onChange={(event) => setSpecialistLeads(event.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  {t('integrations.modules.addDepartmentLeads', {
                    defaultValue: 'Let the specialist lead instead of {{lead}}',
                    lead: existing.lead_name,
                  })}
                </span>
              </label>
            ) : null}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            type="button"
            disabled={busy || !plan}
            onClick={() =>
              onConfirm({
                department_id: target === NEW_DEPARTMENT ? null : target,
                accountable_user_id: accountable || null,
                specialist_leads: existing?.lead_name ? specialistLeads : null,
              })
            }
          >
            {t('integrations.modules.addDepartment', { defaultValue: 'Add department' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function UninstallDialog({
  open,
  step,
  name,
  busy,
  onOpenChange,
  onAdvance,
  onConfirm,
}: {
  open: boolean
  step: 0 | 1 | 2
  name: string
  busy: boolean
  onOpenChange: (open: boolean) => void
  onAdvance: () => void
  onConfirm: () => void
}) {
  const { t } = useTranslation(['nav', 'common'])
  const second = step === 2
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {second
              ? t('integrations.modules.uninstallTitle2', {
                  defaultValue: 'Really uninstall {{name}}?',
                  name,
                })
              : t('integrations.modules.uninstallTitle', {
                  defaultValue: 'Uninstall {{name}}?',
                  name,
                })}
          </DialogTitle>
          <DialogDescription>
            {second
              ? t('integrations.modules.uninstallConfirm2', {
                  defaultValue:
                    'This removes {{name}} from your workspace and from the AI menu. Platform integrations stay connected.',
                  name,
                })
              : t('integrations.modules.uninstallConfirm', {
                  defaultValue:
                    'Agents stop using {{name}}. Connected integrations on the platform stay in place.',
                  name,
                })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('common:actions.cancel')}
          </Button>
          {second ? (
            <Button type="button" variant="destructive" disabled={busy} onClick={onConfirm}>
              {t('integrations.modules.uninstallConfirmAction', {
                defaultValue: 'Yes, uninstall',
              })}
            </Button>
          ) : (
            <Button type="button" variant="destructive" disabled={busy} onClick={onAdvance}>
              {t('integrations.modules.uninstallContinue', { defaultValue: 'Continue' })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
