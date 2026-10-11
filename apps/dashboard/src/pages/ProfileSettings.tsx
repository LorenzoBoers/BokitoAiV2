import { ProfileSettingsContent } from '../components/profile/ProfileSettingsContent'
import { PageContent } from '../components/layout/PageContent'

export default function ProfileSettings() {
  return (
    <PageContent width="lg" className="space-y-6 py-1">
      <ProfileSettingsContent />
    </PageContent>
  )
}
