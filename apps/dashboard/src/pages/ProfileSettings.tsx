import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'
import { ProfileSettingsContent } from '../components/profile/ProfileSettingsContent'
import { PageContent } from '../components/layout/PageContent'

export default function ProfileSettings() {
  const { t } = useTranslation('profile')
  const { pathname } = useLocation()
  const isAccessSecurity = pathname.includes('access-security')

  return (
    <PageContent width="lg" className="space-y-6 py-1">
      <p className="text-sm text-text-secondary">
        {isAccessSecurity
          ? 'Beheer je wachtwoord en accountinstellingen.'
          : t('personalInformation.description')}
      </p>

      <ProfileSettingsContent securityOnly={isAccessSecurity} />
    </PageContent>
  )
}
