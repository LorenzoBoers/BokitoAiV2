import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft } from 'lucide-react'
import {
  localizeApplication,
  localizeOfferDescription,
  type IntegrationApplication,
  type IntegrationOffer,
} from '../../lib/integration-applications'
import { IntegrationHostLogo } from './IntegrationHostLogo'
import { IntegrationSetupPanel } from './IntegrationSetupPanel'
import { IntegrationDetailPanel } from './IntegrationDetailPanel'
import type { HubBanner } from './IntegrationHubDialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'

export type ApplicationHubStep = 'app' | 'offer-detail' | 'offer-setup'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  application: IntegrationApplication | null
  initialStep?: ApplicationHubStep
  initialOfferId?: string | null
  banner?: HubBanner
  onViewConnected: (offer: IntegrationOffer) => void
  onSaved: () => void
}

function kindLabelKey(kind: IntegrationOffer['kind']): string {
  return `integrations.kind.${kind}`
}

export function ApplicationHubDialog({
  open,
  onOpenChange,
  application,
  initialStep = 'app',
  initialOfferId = null,
  banner = null,
  onViewConnected,
  onSaved,
}: Props) {
  const { t } = useTranslation('nav')
  const [step, setStep] = useState<ApplicationHubStep>(initialStep)
  const [activeOffer, setActiveOffer] = useState<IntegrationOffer | null>(null)

  useEffect(() => {
    if (!open || !application) return
    setStep(initialStep)
    if (initialOfferId) {
      const offer = application.offers.find((o) => o.integration.id === initialOfferId)
      setActiveOffer(offer ?? null)
    } else {
      setActiveOffer(null)
    }
  }, [open, application, initialStep, initialOfferId])

  if (!application) return null

  const localized = localizeApplication(application, t)
  const title =
    step === 'offer-setup'
      ? t('integrations.hub.setup.title', { name: activeOffer?.integration.name ?? localized.name })
      : step === 'offer-detail'
        ? (activeOffer?.integration.name ?? localized.name)
        : localized.name

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-start gap-3">
            {step !== 'app' ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 shrink-0 mt-0.5"
                onClick={() => {
                  if (step === 'offer-setup') setStep('offer-detail')
                  else setStep('app')
                }}
                aria-label={t('integrations.hub.setup.back')}
              >
                <ChevronLeft size={18} />
              </Button>
            ) : null}
            <IntegrationHostLogo
              logoUrl={application.brand.logoUrl}
              logoDarkUrl={application.brand.logoDarkUrl}
              initials={application.brand.initials}
              color={application.brand.color}
              name={localized.name}
              hostSlug={application.brand.hostSlug}
              size="md"
            />
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-left">{title}</DialogTitle>
              {step === 'app' ? (
                <DialogDescription className="text-left">
                  {t('integrations.application.hubSubtitle', { count: application.offers.length })}
                </DialogDescription>
              ) : step === 'offer-detail' ? (
                <DialogDescription className="text-left">
                  {t('integrations.hub.detail.subtitle')}
                </DialogDescription>
              ) : null}
            </div>
          </div>
        </DialogHeader>

        {step === 'app' ? (
          <div className="space-y-4">
            {banner ? (
              <p
                className={`text-xs rounded-md px-3 py-2 border ${
                  banner.type === 'success'
                    ? 'border-status-success/30 bg-status-success/10 text-status-success'
                    : 'border-status-error/30 bg-status-error/10 text-status-error'
                }`}
              >
                {banner.message}
              </p>
            ) : null}
            <p className="text-sm text-text-secondary leading-relaxed">{localized.description}</p>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              {t('integrations.application.connectionTypes')}
            </p>
            <ul className="space-y-2">
              {application.offers.map((offer) => (
                <li key={offer.integration.id}>
                  <button
                    type="button"
                    className="w-full text-left rounded-lg border border-border/60 px-3 py-3 hover:bg-bg-muted/40 transition-colors"
                    onClick={() => {
                      setActiveOffer(offer)
                      setStep('offer-detail')
                    }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-text-primary">
                            {offer.integration.name}
                          </span>
                          <Badge variant="neutral" className="text-[10px] uppercase">
                            {t(kindLabelKey(offer.kind))}
                          </Badge>
                        </div>
                        <p className="text-xs text-text-muted mt-1 line-clamp-2">
                          {localizeOfferDescription(
                            application.hostSlug,
                            offer.integration.description,
                            t,
                          )}
                        </p>
                      </div>
                      {offer.connectionCount > 0 ? (
                        <span className="text-[10px] text-status-success shrink-0">
                          {t('integrations.application.connectedShort')}
                        </span>
                      ) : offer.integration.status === 'coming_soon' ? (
                        <span className="text-[10px] text-text-muted shrink-0">
                          {t('integrations.actions.comingSoon')}
                        </span>
                      ) : null}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {step === 'offer-detail' && activeOffer ? (
          <IntegrationDetailPanel
            integration={activeOffer.integration}
            provider={activeOffer.provider}
            connectionCount={activeOffer.connectionCount}
            banner={null}
            onSetup={() => setStep('offer-setup')}
            onViewConnected={() => onViewConnected(activeOffer)}
            onAddAccount={
              activeOffer.integration.id === 'github' && activeOffer.connectionCount > 0
                ? () => setStep('offer-setup')
                : undefined
            }
          />
        ) : null}

        {step === 'offer-setup' && activeOffer ? (
          <IntegrationSetupPanel
            integration={activeOffer.integration}
            provider={activeOffer.provider}
            onSaved={() => {
              onSaved()
              onOpenChange(false)
            }}
            onBack={() => setStep('offer-detail')}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
