import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'
import { ProfileSettingsContent } from '../components/profile/ProfileSettingsContent'

export default function ProfileSettings() {
  const { t } = useTranslation('profile')
  const { pathname } = useLocation()
  const isAccessSecurity = pathname.includes('access-security')

  return (
    <div className="mx-auto w-full max-w-[1000px] space-y-7 px-2 py-1.5">
      <section className="space-y-1">
        <h2 className="text-[28px] font-semibold leading-tight text-text-heading">
          {isAccessSecurity ? 'Beveiliging' : t('personalInformation.title')}
        </h2>
        <p className="text-sm text-text-secondary">
          {isAccessSecurity ? 'Beheer je wachtwoord en accountinstellingen.' : t('personalInformation.description')}
        </p>
      </section>

      <ProfileSettingsContent securityOnly={isAccessSecurity} />
    </div>
  )
}
