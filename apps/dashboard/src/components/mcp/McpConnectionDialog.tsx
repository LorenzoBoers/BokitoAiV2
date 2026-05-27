import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { IntegrationHostLogo } from '../integrations/IntegrationHostLogo'
import { useIntegrationBrand } from '../../context/IntegrationBrandContext'
import { McpConnectionForm, type McpConnectPreset } from './McpConnectionForm'

export type { McpConnectPreset }

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  presetProvider?: McpConnectPreset
}

export function McpConnectionDialog({ open, onOpenChange, onSaved, presetProvider }: Props) {
  const { t } = useTranslation('nav')
  const provider = presetProvider ?? 'custom_mcp'
  const isBjorn = provider === 'bjorn_lunden_mcp'
  const brand = useIntegrationBrand(provider)

  const title = isBjorn
    ? t('integrations.mcp.servers.dialogBjornTitle')
    : t('integrations.mcp.servers.addTitle')

  const description = isBjorn
    ? t('integrations.mcp.servers.dialogBjornDescription')
    : t('integrations.mcp.servers.modalDescription')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <IntegrationHostLogo
              logoUrl={brand.logoUrl}
              logoDarkUrl={brand.logoDarkUrl}
              initials={brand.initials}
              color={brand.color}
              name={brand.name}
              hostSlug={brand.hostSlug}
              size="md"
            />
            <div className="min-w-0">
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <McpConnectionForm
          presetProvider={provider}
          onSaved={() => {
            onSaved()
            onOpenChange(false)
          }}
          onCancel={() => onOpenChange(false)}
          showActions
        />
      </DialogContent>
    </Dialog>
  )
}
