import { useTranslation } from 'react-i18next'
import { ProfileSettingsContent } from '../components/profile/ProfileSettingsContent'

export default function WorkspaceAccount() {
  const { t } = useTranslation('workspaces')

  return (
    <div className="mx-auto w-full max-w-[980px] space-y-7 px-8 py-8">
      <section className="space-y-1">
        <h1 className="text-[28px] font-semibold leading-tight text-text-heading">
          {t('account.title')}
        </h1>
        <p className="text-sm text-text-secondary">{t('account.profile.description')}</p>
      </section>

      <ProfileSettingsContent />
    </div>
  )
}
