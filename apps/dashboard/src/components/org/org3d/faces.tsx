import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import type { OrgFlowNode } from '../../../lib/org-flow-api'
import { Avatar } from '../../ui/avatar'
import { ChannelMark } from '../../ui/ChannelMark'
import { FlowMark } from '../FlowMark'

export type MountedFace = { el: HTMLElement; unmount: () => void }

function mountReact(node: ReactNode, size: number): MountedFace {
  const el = document.createElement('span')
  el.style.cssText = `display:block;flex:none;width:${size}px;height:${size}px`
  const root = createRoot(el)
  root.render(node)
  return { el, unmount: () => setTimeout(() => root.unmount(), 0) }
}

/** Avatar, flow mark or channel mark for a 3D chip, matching the 2D card face. */
export function mountFace(node: OrgFlowNode, size = 26): MountedFace | null {
  if (node.kind === 'agent' || node.kind === 'user') {
    return mountReact(
      <Avatar kind="agent" agent={node.mark ?? { name: node.label }} size={size} mode="static" fallbackName={node.label} />,
      size,
    )
  }
  if (node.kind === 'flow') {
    return mountReact(<FlowMark node={node} size={size} />, size)
  }
  if (node.kind === 'channel') {
    return mountReact(<ChannelMark channel={node.channel} size={size} />, size)
  }
  return null
}
