import { createLucideIcon, type LucideProps } from 'lucide-react'
import { forwardRef } from 'react'
import { cn } from './utils'

/**
 * All three AI-handling icons share the Lucide grammar of the Manual `Hand`
 * icon: 24x24 grid, stroke 2, round caps and joins, no fills.
 */

/** Inline styles: CSS vars in SVG presentation attributes fall back to currentColor. */
const HUMAN_STROKE = { stroke: 'rgb(var(--color-text-muted))' } as const
const AI_STROKE = { stroke: 'rgb(var(--color-ai-ink))' } as const

/**
 * Autonomous: Lucide `RotateCw` loop with a large “A” in the centre (violet).
 * One arc + one arrowhead keeps the A legible at 14–16px.
 */
export const AutonomousModeIcon = createLucideIcon('AutonomousMode', [
  ['path', { d: 'M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8', key: 'arc' }],
  ['path', { d: 'M21 3v5h-5', key: 'head' }],
  ['path', { d: 'M8.5 16.5 12 7.5l3.5 9', key: 'a1' }],
  ['path', { d: 'M9.9 13.5h4.2', key: 'a2' }],
])

/**
 * Assisted: the Lucide `Handshake` icon, split per hand.
 * Left hand (coming from top-left) is the human, grey like Manual.
 * Right hand (coming from top-right) is the AI, violet like Autonomous.
 */
export const AssistedModeIcon = forwardRef<SVGSVGElement, LucideProps>(
  function AssistedModeIcon(
    { className, size = 24, strokeWidth = 2, absoluteStrokeWidth, color: _color, ...props },
    ref,
  ) {
    const px = typeof size === 'number' ? size : Number.parseInt(String(size), 10) || 24
    const stroke =
      absoluteStrokeWidth != null
        ? (Number(strokeWidth) * 24) / px
        : strokeWidth
    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={stroke}
        className={cn('lucide lucide-handshake', className)}
        aria-hidden={props['aria-label'] ? undefined : true}
        {...props}
      >
        {/* Human hand (grey): left forearm + the three fingers gripping from below */}
        <path style={HUMAN_STROKE} d="M3 4h8" />
        <path style={HUMAN_STROKE} d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3" />
        <path style={HUMAN_STROKE} d="m11 17 2 2a1 1 0 1 0 3-3" />
        <path style={HUMAN_STROKE} d="m14 14 2.5 2.5a1 1 0 1 0 3-3" />
        {/* AI hand (violet): right forearm + thumb wrapping over the wrist */}
        <path style={AI_STROKE} d="m21 3 1 11h-2" />
        <path
          style={AI_STROKE}
          d="M19.5 13.5l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4"
        />
      </svg>
    )
  },
)
AssistedModeIcon.displayName = 'AssistedModeIcon'
