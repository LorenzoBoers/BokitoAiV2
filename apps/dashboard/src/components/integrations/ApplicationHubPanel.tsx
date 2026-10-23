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
import { ModuleUsageNote } from './ModuleUsageNote'
import { modulesForApplication } from '../../lib/module-applications'
import type { IntegrationModuleRow } from '../../lib/integrations-api'
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

export type HubBanner = { type: 'success' | 'error'; message: string } | null

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  application: IntegrationApplication | null
  initialStep?: ApplicationHubStep
  initialOfferId?: string | null
  banner?: HubBanner
  /** Catalog modules, so the panel can name what agents do with this login. */
  modules?: IntegrationModuleRow[]
  onViewConnected: (offer: IntegrationOffer) => void
  onSaved: () => void
}

function kindLabelKey(kind: IntegrationOffer['kind']): string {
  return `integrations.kind.${kind}`
}

/**
 * Showcase modal for one connectable program: pick the offer when a vendor has
 * several, read what it does, connect, or manage existing connections.
 * `?connect={slug}` on the Connections page opens it directly.
 */
export function ApplicationHubPanel({
  open,
  onOpenChange,
  application,
  initialStep = 'app',
  initialOfferId = null,
  banner = null,
  modules = [],
  onViewConnected,
  onSaved,
}: Props) {
  const { t } = useTranslation('nav')
  const [step, setStep] = useState<ApplicationHubStep>(initialStep)
  const [activeOffer, setActiveOffer] = useState<IntegrationOffer | null>(null)

  useEffect(() => {
    if (!open || !application) return
    const fromId = initialOfferId
      ? application.offers.find((o) => o.integration.id === initialOfferId) ?? null
      : null
    const onlyOffer = application.offers.length === 1 ? application.offers[0] : null
    const offer = fromId ?? onlyOffer
    const skipChooser = !fromId && onlyOffer && initialStep === 'app'
    setActiveOffer(offer)
    setStep(skipChooser ? 'offer-detail' : initialStep)
  }, [open, application, initialStep, initialOfferId])

  if (!application) return null

  const usableModules = modulesForApplication(modules, application)
  const localized = localizeApplication(application, t)
  const title =
    step === 'offer-setup'
      ? t('integrations.hub.setup.title', { name: activeOffer?.integration.name ?? localized.name })
      : step === 'offer-detail'
        ? (activeOffer?.integration.name ?? localized.name)
        : localized.name

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:rounded-xl">
        <DialogHeader className="shrink-0 space-y-0 border-b border-border px-6 py-5 pr-14 text-left">
          <div className="flex items-start gap-4">
            {step !== 'app' ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="mt-1 shrink-0 p-0"
                onClick={() => {
                  if (step === 'offer-setup') {
                    setStep('offer-detail')
                    return
                  }
                  if (application.offers.length > 1 && !initialOfferId) {
                    setStep('app')
                    return
                  }
                  onOpenChange(false)
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
              size="lg"
            />
            <div className="min-w-0 flex-1 space-y-1">
              <DialogTitle className="text-xl">{title}</DialogTitle>
              {step === 'app' ? (
                <DialogDescription>
                  {t('integrations.application.hubSubtitle', { count: application.offers.length })}
                </DialogDescription>
              ) : step === 'offer-detail' ? (
                <DialogDescription>{t('integrations.hub.detail.subtitle')}</DialogDescription>
              ) : (
                <DialogDescription className="sr-only">{title}</DialogDescription>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {step === 'app' ? (
            <div className="space-y-4">
              {banner ? (
                <p
                  className={`rounded-md border px-3 py-2 text-xs ${
                    banner.type === 'success'
                      ? 'border-status-success/30 bg-status-success/10 text-status-success'
                      : 'border-status-error/30 bg-status-error/10 text-status-error'
                  }`}
                >
                  {banner.message}
                </p>
              ) : null}
              <p className="text-sm leading-relaxed text-text-secondary">{localized.description}</p>
              <ModuleUsageNote modules={usableModules} />
              <p className="text-2xs font-semibold text-text-muted">
                {t('integrations.application.connectionTypes')}
              </p>
              <ul className="space-y-2">
                {application.offers.map((offer) => (
                  <li key={offer.integration.id}>
                    <button
                      type="button"
                      className="w-full rounded-lg border border-border px-3 py-3 text-left transition-colors hover:bg-bg-muted/40"
                      onClick={() => {
                        setActiveOffer(offer)
                        setStep('offer-detail')
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-text-primary">
                              {offer.integration.name}
                            </span>
                            <Badge variant="neutral" className="text-2xs">
                              {t(kindLabelKey(offer.kind))}
                            </Badge>
                          </div>
                          <p className="mt-1 line-clamp-2 text-xs text-text-muted">
                            {localizeOfferDescription(offer, offer.integration.description, t)}
                          </p>
                        </div>
                        {offer.connectionCount > 0 ? (
                          <span className="shrink-0 text-2xs text-status-success">
                            {t('integrations.application.connectedShort')}
                          </span>
                        ) : offer.integration.status === 'coming_soon' ? (
                          <span className="shrink-0 text-2xs text-text-muted">
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
              banner={banner}
              onSetup={() => setStep('offer-setup')}
              onViewConnected={() => onViewConnected(activeOffer)}
              onChanged={onSaved}
            >
              <ModuleUsageNote modules={usableModules} />
            </IntegrationDetailPanel>
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
        </div>
      </DialogContent>
    </Dialog>
  )
}
