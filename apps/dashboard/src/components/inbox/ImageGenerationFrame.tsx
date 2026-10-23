import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ImageFrameState } from '../../lib/agentActivity'
import { cn } from '../../lib/utils'

/** Square frame for a generate_image call. The shimmer is the placeholder; the file fades in on top. */
export function ImageGenerationFrame({ frame }: { frame: ImageFrameState }) {
  const { t } = useTranslation('communication')
  const [shown, setShown] = useState(false)
  const pending = frame.status === 'running' || (Boolean(frame.src) && !shown)
  const label = frame.status === 'error' ? t('activity.imageFailed') : t('activity.generatingImage')
  return (
    <div
      className="relative aspect-square w-64 max-w-full overflow-hidden rounded-lg border border-border bg-bg-elevated"
      role="status"
      aria-busy={pending || undefined}
      aria-label={frame.status === 'ready' && shown ? frame.alt || label : label}
      data-testid="image-generation-frame"
      data-status={frame.status}
    >
      {frame.src ? (
        <img
          src={frame.src}
          alt={frame.alt || ''}
          className={cn(
            'absolute inset-0 h-full w-full object-cover transition-opacity duration-300',
            shown ? 'opacity-100' : 'opacity-0',
          )}
          onLoad={() => setShown(true)}
        />
      ) : null}
      {frame.status === 'error' && !frame.src ? (
        <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-text-muted">
          {t('activity.imageFailed')}
        </div>
      ) : pending ? (
        <div className="skeleton-shimmer absolute inset-0" />
      ) : null}
    </div>
  )
}

export function ImageGenerationFrames({ frames }: { frames: ImageFrameState[] }) {
  if (!frames.length) return null
  return (
    <div className="mt-1.5 flex flex-wrap gap-2">
      {frames.map((frame) => (
        <ImageGenerationFrame key={frame.id} frame={frame} />
      ))}
    </div>
  )
}
