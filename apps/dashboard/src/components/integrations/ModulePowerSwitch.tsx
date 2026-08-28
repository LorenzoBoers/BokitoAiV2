import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Switch } from '../ui/switch'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { moduleIsOn, type IntegrationModuleRow } from '../../lib/integration-modules'

type Props = {
  module: Pick<IntegrationModuleRow, 'slug' | 'name' | 'enabled' | 'tenant_status' | 'status'>
  onToggle: (slug: string, enabled: boolean) => Promise<unknown>
}

export function ModulePowerSwitch({ module, onToggle }: Props) {
  const { t } = useTranslation(['nav', 'common'])
  const [busy, setBusy] = useState(false)
  const [confirmOff, setConfirmOff] = useState(false)
  const comingSoon = module.status === 'coming_soon'
  const on = moduleIsOn(module)
  const name = t(`integrations.modules.${module.slug}.name`, { defaultValue: module.name || module.slug })

  const runToggle = (next: boolean) => {
    setBusy(true)
    void onToggle(module.slug, next)
      .then(() => {
        toast.success(
          t(next ? 'integrations.modules.turnedOn' : 'integrations.modules.turnedOff', {
            defaultValue: next ? '{{name}} is on.' : '{{name}} is off.',
            name,
          }),
        )
      })
      .catch(() => {
        toast.error(
          t('integrations.modules.toggleError', {
            defaultValue: 'Could not update this module.',
          }),
        )
      })
      .finally(() => setBusy(false))
  }

  return (
    <>
      <Switch
        checked={on}
        disabled={busy || comingSoon}
        onCheckedChange={(next) => {
          if (comingSoon) return
          if (!next) {
            setConfirmOff(true)
            return
          }
          runToggle(true)
        }}
        aria-label={t(on ? 'integrations.modules.turnOff' : 'integrations.modules.turnOn', {
          defaultValue: on ? 'Turn off' : 'Turn on',
        })}
      />
      <Dialog open={confirmOff} onOpenChange={setConfirmOff}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t('integrations.modules.turnOffTitle', {
                defaultValue: 'Turn {{name}} off?',
                name,
              })}
            </DialogTitle>
            <DialogDescription>
              {t('integrations.modules.turnOffConfirm', {
                defaultValue:
                  'Turn {{name}} off? Agents stop using it. Connected packages stay in place.',
                name,
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setConfirmOff(false)} disabled={busy}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => {
                setConfirmOff(false)
                runToggle(false)
              }}
            >
              {t('integrations.modules.turnOff', { defaultValue: 'Turn off' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
