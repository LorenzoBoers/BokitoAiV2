import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '../ui/button'
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
  type IntegrationModuleRow,
} from '../../lib/integration-modules'

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
  >
  onAction: (slug: string, action: LifecycleAction) => Promise<unknown>
  /** Compact buttons for cards; default shows primary + secondary. */
  compact?: boolean
}

export function ModuleInstallControls({ module, onAction, compact = false }: Props) {
  const { t } = useTranslation(['nav', 'common'])
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [uninstallStep, setUninstallStep] = useState<0 | 1 | 2>(0)
  const comingSoon = module.status === 'coming_soon'
  const state = moduleInstallState(module)
  const installed = moduleIsOn(module)
  const name = t(`integrations.modules.${module.slug}.name`, {
    defaultValue: module.name || module.slug,
  })

  const run = (action: LifecycleAction, thenNavigate?: string) => {
    setBusy(true)
    void onAction(module.slug, action)
      .then(() => {
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
                ? '{{name}} is ready for setup.'
                : action === 'complete_setup'
                  ? '{{name}} is installed.'
                  : '{{name}} was uninstalled.',
            name,
          }),
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
      })
  }

  if (comingSoon) {
    return (
      <Button type="button" size="sm" variant="outline" disabled>
        {t('integrations.modules.comingSoon', { defaultValue: 'Coming soon' })}
      </Button>
    )
  }

  if (state === 'not_installed') {
    return (
      <Button
        type="button"
        size="sm"
        disabled={busy}
        onClick={() => run('install', `${moduleHomePath(module)}?tab=setup`)}
      >
        {t('integrations.modules.install', { defaultValue: 'Install' })}
      </Button>
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
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => setUninstallStep(1)}
        >
          {t('integrations.modules.uninstall', { defaultValue: 'Uninstall' })}
        </Button>
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

  return (
    <div className="flex flex-wrap items-center gap-2">
      {installed ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
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
