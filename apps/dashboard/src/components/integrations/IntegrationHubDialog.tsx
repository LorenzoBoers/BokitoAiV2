import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft } from 'lucide-react'
import type { Integration } from '../../data/integrations-data'
import type { IntegrationProviderRow } from '../../lib/integrations-api'
import type { IntegrationHubStep } from '../../lib/integration-setup-url'
import { IntegrationHostLogo } from './IntegrationHostLogo'
import { IntegrationDetailPanel } from './IntegrationDetailPanel'
import { IntegrationSetupPanel } from './IntegrationSetupPanel'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { Button } from '../ui/button'

export type HubBanner = { type: 'success' | 'error'; message: string } | null

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  integration: Integration | null
  provider?: IntegrationProviderRow | null
  connectionCount: number
  initialStep?: IntegrationHubStep
  banner?: HubBanner
  onBannerClear?: () => void
  onViewConnected: () => void
  onAddAccount?: () => void
  onSaved: () => void
}

export function IntegrationHubDialog({
  open,
  onOpenChange,
  integration,
  provider,
  connectionCount,
  initialStep = 'detail',
  banner = null,
  onViewConnected,
  onAddAccount,
  onSaved,
}: Props) {
  const { t } = useTranslation('nav')
  const [step, setStep] = useState<IntegrationHubStep>(initialStep)

  useEffect(() => {
    if (open) setStep(initialStep)
  }, [open, initialStep])

  if (!integration) return null

  const title =
    step === 'setup'
      ? t('integrations.hub.setup.title', { name: integration.name })
      : integration.name

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-start gap-3">
            {step === 'setup' ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 shrink-0 mt-0.5"
                onClick={() => setStep('detail')}
                aria-label={t('integrations.hub.setup.back')}
              >
                <ChevronLeft size={18} />
              </Button>
            ) : null}
            <IntegrationHostLogo
              logoUrl={integration.logoUrl}
              logoDarkUrl={integration.logoDarkUrl}
              initials={integration.initials}
              color={integration.color}
              name={integration.name}
              hostSlug={integration.hostSlug}
              size="md"
            />
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-left">{title}</DialogTitle>
              {step === 'detail' ? (
                <DialogDescription className="text-left">
                  {t('integrations.hub.detail.subtitle')}
                </DialogDescription>
              ) : null}
            </div>
          </div>
        </DialogHeader>

        {step === 'detail' ? (
          <IntegrationDetailPanel
            integration={integration}
            provider={provider}
            connectionCount={connectionCount}
            banner={banner}
            onSetup={() => setStep('setup')}
            onViewConnected={onViewConnected}
            onAddAccount={onAddAccount}
          />
        ) : (
          <IntegrationSetupPanel
            integration={integration}
            provider={provider}
            onSaved={() => {
              onSaved()
              onOpenChange(false)
            }}
            onBack={() => setStep('detail')}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
