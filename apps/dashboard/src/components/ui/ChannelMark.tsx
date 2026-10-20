import type { ReactNode } from 'react'
import { FLOW_LABEL_COLOR, labelMarkInk } from './label-marks'
import { ChannelGlyph } from './ChannelGlyph'

/** Channel mark in the same circle style as a flow pillar icon: glyph on a soft wash. */
export function ChannelMark({
  channel,
  size = 24,
  children,
}: {
  channel?: string
  size?: number
  /** Optional face (e.g. mailbox provider logo) instead of the default channel glyph. */
  children?: ReactNode
}) {
  const tone = labelMarkInk('sky') ?? labelMarkInk(FLOW_LABEL_COLOR)!
  const glyph = Math.max(11, Math.round(size * 0.56))
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full"
      style={{ width: size, height: size, background: tone.wash, color: tone.ink }}
      aria-hidden
    >
      {children ?? <ChannelGlyph channel={channel || 'email'} size={glyph} className="text-current" />}
    </span>
  )
}
