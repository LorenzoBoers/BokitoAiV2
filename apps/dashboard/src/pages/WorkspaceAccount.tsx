import { useTranslation } from 'react-i18next'
import { ProfileSettingsContent } from '../components/profile/ProfileSettingsContent'
import { PageContent } from '../components/layout/PageContent'
import ContentHeader from '../components/shell/ContentHeader'

export default function WorkspaceAccount() {
  const { t } = useTranslation('workspaces')

  return (
    <PageContent width="lg" className="space-y-7">
      <ContentHeader title={t('account.title')} subtitle={t('account.profile.description')} className="mb-0" />
      <ProfileSettingsContent />
    </PageContent>
  )
}
