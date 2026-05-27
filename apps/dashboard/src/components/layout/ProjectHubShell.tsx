import { Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { PageContent } from './PageContent'

/**
 * Project hub wrapper. Tab navigation lives in the contextual sidebar
 * (Overview, Documentation, Projects, Communication); this shell only
 * provides the canvas width and a short hub description.
 */
export default function ProjectHubShell() {
  const { t } = useTranslation('nav')
  const { pathname } = useLocation()
  const isDocsRoute = pathname.startsWith('/projects/docs')

  return (
    <PageContent width={isDocsRoute ? 'full' : 'xl'} className={isDocsRoute ? '' : 'space-y-4'}>
      {isDocsRoute ? null : (
        <p className="text-sm text-text-muted">{t('projectHub.description')}</p>
      )}
      <Outlet />
    </PageContent>
  )
}
