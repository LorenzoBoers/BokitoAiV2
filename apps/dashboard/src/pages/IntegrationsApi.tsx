import { useTranslation } from 'react-i18next'
import { KeyRound } from 'lucide-react'
import { Badge } from '../components/ui/badge'

export default function IntegrationsApi() {
  const { t } = useTranslation('nav')

  return (
    <div className="h-full min-h-0 py-4 px-1">
      <div className="max-w-lg rounded-xl border border-border/60 bg-bg-elevated/30 p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-bg-hover">
          <KeyRound size={22} className="text-text-muted" />
        </div>
        <h2 className="text-sm font-semibold text-text-heading">{t('integrations.pageMeta.api.title')}</h2>
        <p className="text-xs text-text-secondary mt-2">{t('integrations.pageMeta.api.description')}</p>
        <Badge variant="neutral" className="mt-4">
          {t('integrations.pageMeta.api.comingSoon')}
        </Badge>
        <p className="text-xs text-text-muted mt-4">{t('integrations.pageMeta.api.comingSoonBody')}</p>
      </div>
    </div>
  )
}
