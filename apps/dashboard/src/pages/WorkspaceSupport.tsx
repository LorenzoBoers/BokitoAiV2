import { useTranslation } from 'react-i18next'
import { Card } from '../components/ui/card'

export default function WorkspaceSupport() {
  const { t } = useTranslation('workspaces')

  return (
    <div className="flex min-h-full items-center justify-center py-12">
      <div className="w-full max-w-[980px] space-y-4 px-6">
        <h1 className="text-[28px] font-semibold leading-tight text-text-heading">{t('support.title')}</h1>
        <Card className="p-5">
          <p className="text-sm text-text-secondary">{t('support.placeholder')}</p>
        </Card>
      </div>
    </div>
  )
}
