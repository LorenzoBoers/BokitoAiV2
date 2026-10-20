import { Route } from 'lucide-react'
import { FLOW_LABEL_COLOR, labelMarkIcon, labelMarkInk } from '../ui/label-marks'
import type { OrgFlowNode } from '../../lib/org-flow-api'

/** A flow's label mark on the Grid: its icon in its label color, on a soft wash of that color. */
export function FlowMark({ node, size = 24 }: { node: Pick<OrgFlowNode, 'color' | 'icon'>; size?: number }) {
  const Icon = labelMarkIcon(node.icon) ?? Route
  const tone = labelMarkInk(node.color) ?? labelMarkInk(FLOW_LABEL_COLOR)!
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full"
      style={{ width: size, height: size, background: tone.wash, color: tone.ink }}
      aria-hidden
    >
      <Icon size={Math.round(size * 0.56)} strokeWidth={1.7} />
    </span>
  )
}
