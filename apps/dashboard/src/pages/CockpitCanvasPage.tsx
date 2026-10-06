import { useTranslation } from 'react-i18next'
import ContentHeader from '../components/shell/ContentHeader'
import WorkspaceIdHint from '../components/shell/WorkspaceIdHint'
import CockpitTabs from '../components/shell/CockpitTabs'
import { PageContent } from '../components/layout/PageContent'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { useIsAdmin } from '../hooks/useIsAdmin'
import { workspaceBrandName } from '../lib/tenant-branding'
import { CanvasHost } from '../components/project-canvas/CanvasHost'

export default function CockpitCanvasPage() {
  const { t } = useTranslation('nav')
  const { user } = useAuth()
  const { currentWorkspace } = useWorkspace()
  const isAdmin = useIsAdmin()
  const ownerId = user?.organisationId ? String(user.organisationId) : ''

  return (
    <PageContent width="xl">
      <ContentHeader
        title={workspaceBrandName(currentWorkspace)}
        subtitle={t('pageHeaders.cockpitCanvas')}
        meta={<WorkspaceIdHint />}
      />
      <CockpitTabs />
      {ownerId ? <CanvasHost ownerKind="tenant" ownerId={ownerId} canEdit={isAdmin} /> : null}
    </PageContent>
  )
}
