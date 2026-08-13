import { useTranslation } from 'react-i18next'
import { ProfileSettingsContent } from '../components/profile/ProfileSettingsContent'
import { PageContent } from '../components/layout/PageContent'

export default function ProfileSettings() {
  const { t } = useTranslation('profile')

  return (
    <PageContent width="lg" className="space-y-6 py-1">
      <p className="text-sm text-text-secondary">{t('personalInformation.description')}</p>

      <ProfileSettingsContent />
    </PageContent>
  )
}
