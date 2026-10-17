import { cn } from '../../lib/utils'

/**
 * Soft corner wash, in the spirit of the Chrome profile screen: four large
 * radial tints (brand, agent violet, info blue) that fade before the middle.
 * The parent must be `relative` (and usually `overflow-hidden`).
 */
export function AmbientSpotlights({ className }: { className?: string }) {
  return <div aria-hidden className={cn('ambient-spotlights pointer-events-none absolute inset-0', className)} />
}
