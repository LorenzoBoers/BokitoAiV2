import { useTranslation } from 'react-i18next'
import { PageHeader } from '../components/ui/page-header'
import WorkspaceIdHint from '../components/shell/WorkspaceIdHint'
import { PageContent } from '../components/layout/PageContent'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { formatAppDate } from '../lib/app-locale'
import { greetingBucket, greetingFirstName } from '../lib/cockpit-greeting'
import { workspaceBrandName } from '../lib/tenant-branding'
import OverviewFourBlocks from '../components/cockpit/OverviewFourBlocks'

export default function CockpitPage() {
  const { t, i18n } = useTranslation('nav')
  const { user } = useAuth()
  const { currentWorkspace } = useWorkspace()
  const greetingName = greetingFirstName(user?.firstName || user?.name)
  const bucket = greetingBucket()
  const greetingKey = greetingName
    ? bucket === 'morning'
      ? 'cockpitPage.greetingMorning'
      : bucket === 'afternoon'
        ? 'cockpitPage.greetingAfternoon'
        : 'cockpitPage.greetingEvening'
    : bucket === 'morning'
      ? 'cockpitPage.greetingMorningPlain'
      : bucket === 'afternoon'
        ? 'cockpitPage.greetingAfternoonPlain'
        : 'cockpitPage.greetingEveningPlain'

  return (
    <div className="h-full overflow-y-auto px-4 py-4 md:px-6">
      <PageContent width="xl">
        <PageHeader
          title={workspaceBrandName(currentWorkspace)}
          subtitle={`${t(greetingKey, { name: greetingName })} · ${formatAppDate(new Date(), i18n.language, {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          })}`}
          guide="cockpit"
          actions={<WorkspaceIdHint />}
        />
        <OverviewFourBlocks />
      </PageContent>
    </div>
  )
}
