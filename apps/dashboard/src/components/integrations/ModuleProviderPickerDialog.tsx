import { useTranslation } from 'react-i18next'
import { Clock } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { IntegrationHostLogo } from './IntegrationHostLogo'
import type { ModulePackageItem } from './ModulePackageGrid'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: ModulePackageItem[]
  onSelect: (item: ModulePackageItem) => void
}

/** Choose which package to register when adding a module connection. */
export function ModuleProviderPickerDialog({ open, onOpenChange, items, onSelect }: Props) {
  const { t } = useTranslation('nav')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t('integrations.modules.connections.pickPackage', {
              defaultValue: 'Choose a package',
            })}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-text-secondary">
          {t('integrations.modules.connections.pickPackageHint', {
            defaultValue:
              'Each registration is a separate login. You can add more than one for the same package.',
          })}
        </p>
        {items.length === 0 ? (
          <p className="text-sm text-text-muted">
            {t('integrations.modules.connections.noPackages', {
              defaultValue: 'No packages for this module yet.',
            })}
          </p>
        ) : (
          <ul className="max-h-80 space-y-1.5 overflow-y-auto">
            {items.map((item) => {
              const planned = item.status === 'coming_soon'
              return (
                <li key={item.key}>
                  <button
                    type="button"
                    disabled={planned}
                    className={`flex w-full items-center gap-3 rounded-lg border border-border/60 px-3 py-2.5 text-left ${
                      planned
                        ? 'cursor-not-allowed opacity-60'
                        : 'hover:border-accent/40 hover:bg-bg-hover/50'
                    }`}
                    onClick={() => {
                      if (planned) return
                      onSelect(item)
                      onOpenChange(false)
                    }}
                  >
                    <IntegrationHostLogo
                      logoUrl={item.logoUrl}
                      logoDarkUrl={item.logoDarkUrl}
                      initials={item.initials}
                      color={item.color}
                      name={item.name}
                      hostSlug={item.hostSlug}
                      size="sm"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-medium text-text-heading">{item.name}</span>
                        {planned ? (
                          <Badge variant="neutral" className="text-[10px]">
                            {t('integrations.modules.plannedBadge', { defaultValue: 'Planned' })}
                          </Badge>
                        ) : null}
                      </span>
                      {item.description ? (
                        <span className="mt-0.5 block truncate text-xs text-text-muted">
                          {item.description}
                        </span>
                      ) : null}
                    </span>
                    {planned ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-text-muted">
                        <Clock size={12} aria-hidden />
                        {t('integrations.actions.comingSoon', { defaultValue: 'Coming soon' })}
                      </span>
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('common:cancel', { defaultValue: 'Cancel' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
