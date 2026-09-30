import { useTranslation } from 'react-i18next'

import type { SurfaceKey } from '@/shell/Shell'

export function SurfacePlaceholder({ surface }: { surface: SurfaceKey }) {
  const { t } = useTranslation()
  return (
    <div className="animate-page-enter p-8">
      <h1 className="text-xl font-semibold text-text-heading">{t(`nav.${surface}`)}</h1>
      <p className="mt-1 text-sm text-text-secondary">{t(`surface.${surface}Intro`)}</p>
    </div>
  )
}
