import { Cpu } from 'lucide-react'
import { cn } from '../../lib/utils'
import { resolveModelIcon, type ResolveModelIconInput } from '../../lib/model-icon'

type Props = ResolveModelIconInput & {
  size?: number
  className?: string
}

/**
 * Always-visible model mark: managed Bokito silhouette (grey), else provider
 * logo, else a generic chip icon. Mirrors ContactAvatar for people pickers.
 */
export function ModelIcon({
  slug,
  modelId,
  provider,
  providerType,
  size = 18,
  className,
}: Props) {
  const icon = resolveModelIcon({ slug, modelId, provider, providerType })

  if (icon.kind === 'managed' && icon.src) {
    return (
      <span
        role="img"
        aria-label={icon.label}
        title={icon.label}
        className={cn('inline-block shrink-0 bg-current text-text-muted', className)}
        style={{
          width: size,
          height: size,
          WebkitMaskImage: `url(${icon.src})`,
          maskImage: `url(${icon.src})`,
          WebkitMaskSize: 'contain',
          maskSize: 'contain',
          WebkitMaskRepeat: 'no-repeat',
          maskRepeat: 'no-repeat',
          WebkitMaskPosition: 'center',
          maskPosition: 'center',
        }}
      />
    )
  }

  if (icon.kind === 'provider' && icon.src) {
    return (
      <img
        src={icon.src}
        alt=""
        aria-hidden
        title={icon.label}
        width={size}
        height={size}
        className={cn('shrink-0 object-contain opacity-80', className)}
        style={{ width: size, height: size }}
      />
    )
  }

  return (
    <span
      aria-hidden
      title={icon.label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md bg-bg-hover text-text-muted',
        className,
      )}
      style={{ width: size, height: size }}
    >
      <Cpu size={Math.max(12, Math.round(size * 0.72))} />
    </span>
  )
}

type LabelProps = ResolveModelIconInput & {
  name: string
  hint?: string
  size?: number
  className?: string
}

/** Icon + title (+ optional muted hint) for selects and lists. */
export function ModelOptionLabel({
  name,
  hint,
  size = 16,
  className,
  ...iconProps
}: LabelProps) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2', className)}>
      <ModelIcon {...iconProps} size={size} />
      <span className="truncate">
        {name}
        {hint ? <span className="text-text-muted"> — {hint}</span> : null}
      </span>
    </span>
  )
}
