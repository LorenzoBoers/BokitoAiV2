import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { PageContent } from '../components/layout/PageContent'
import { RouteShellSkeleton } from '../components/ui/skeleton'
import { EmptyState } from '../components/ui/empty-state'
import { canvasDefaultLocation } from '../lib/project-canvas-api'

/** Old `/cockpit/canvas` links open the canvas on its conversation. */
export default function CanvasRedirectPage() {
  const { t } = useTranslation('nav')
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const canvasId = searchParams.get('canvas')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    canvasDefaultLocation(canvasId)
      .then((location) => {
        if (live) navigate(location.href, { replace: true })
      })
      .catch(() => {
        if (live) setFailed(true)
      })
    return () => {
      live = false
    }
  }, [canvasId, navigate])

  if (failed) {
    return (
      <PageContent width="xl">
        <EmptyState title={t('projects.canvas.loadError')} />
      </PageContent>
    )
  }
  return <RouteShellSkeleton />
}
