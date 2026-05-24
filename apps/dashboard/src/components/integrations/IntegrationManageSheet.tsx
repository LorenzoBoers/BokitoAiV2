import { useTranslation } from 'react-i18next'
import type { GithubConnectionRow } from '../../lib/github-api'
import { IntegrationHostLogo } from './IntegrationHostLogo'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'

type IntegrationManageSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  providerName: string
  logoUrl?: string | null
  logoDarkUrl?: string | null
  initials?: string
  brandColor?: string
  accounts: GithubConnectionRow[]
  loading: boolean
  onAddAccount: () => void
  onRevoke: (connectionId: string) => void
}

export function IntegrationManageSheet({
  open,
  onOpenChange,
  providerName,
  logoUrl,
  logoDarkUrl,
  initials = 'GH',
  brandColor = '#24292f',
  accounts,
  loading,
  onAddAccount,
  onRevoke,
}: IntegrationManageSheetProps) {
  const { t } = useTranslation('nav')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="fixed right-0 top-0 left-auto h-full w-full max-w-md translate-x-0 translate-y-0 rounded-none border-l border-border sm:rounded-none data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right"
      >
        <DialogHeader className="text-left border-b border-border/60 pb-4">
          <div className="flex items-center gap-3">
            <IntegrationHostLogo
              logoUrl={logoUrl}
              logoDarkUrl={logoDarkUrl}
              initials={initials}
              color={brandColor}
              name={providerName}
              size="md"
            />
            <DialogTitle className="text-base font-semibold">
              {providerName}
            </DialogTitle>
          </div>
          <p className="text-xs text-text-secondary font-normal mt-1">
            {t('integrations.pageMeta.connections.description')}
          </p>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2 flex-1 overflow-y-auto">
          {loading ? (
            <p className="text-xs text-text-muted">...</p>
          ) : accounts.length === 0 ? (
            <p className="text-xs text-text-muted">{t('integrations.marketplace.empty')}</p>
          ) : (
            <ul className="space-y-2">
              {accounts.map((account) => (
                <li
                  key={account.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2.5"
                >
                  <span className="text-sm text-text-primary font-medium truncate">
                    {account.github_login}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-text-muted shrink-0"
                    onClick={() => onRevoke(account.id)}
                  >
                    {t('integrations.actions.disconnect')}
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <Button size="sm" className="w-full mt-auto" onClick={onAddAccount}>
            {accounts.length === 0
              ? t('integrations.actions.setupConnection')
              : t('integrations.actions.addAccount')}
          </Button>
        </div>

      </DialogContent>
    </Dialog>
  )
}
