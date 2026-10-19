import {
  BookOpen,
  Boxes,
  Building2,
  Calendar,
  FileText,
  Folder,
  Hash,
  MessagesSquare,
  Plug,
  Route,
  UserRound,
  Webhook,
  Workflow,
} from 'lucide-react'
import { BRAND_ASSETS } from '../../lib/brand-assets'
import { hostSlugForProvider } from '../../lib/integration-brand'
import { DEFAULT_BRAND_MARK } from '../../lib/tenant-branding'
import type { OrgGraphMark, OrgGraphNode } from '../../lib/teams-api'
import { AgentMark } from '../ui/AgentMark'
import { ChannelGlyph } from '../ui/ChannelGlyph'
import { labelMarkIcon, labelMarkInk } from '../ui/label-marks'

const KIND_ICON: Record<string, typeof Building2> = {
  organization: Building2,
  department: Building2,
  user: UserRound,
  channel: MessagesSquare,
  flow: Workflow,
  folder: Folder,
  label: Hash,
  calendar: Calendar,
  connection: Plug,
  doc: FileText,
  source: BookOpen,
  module: Boxes,
  webhook: Webhook,
}

/** Shared face for map pads, legend rows and hover showcase. */
export function OrgNodeFace({
  node,
  size = 20,
  live = false,
}: {
  node: OrgGraphNode
  size?: number
  /** Live AgentMark bob for agents on the canvas. */
  live?: boolean
}) {
  const mark: OrgGraphMark = node.mark ?? {}
  if (node.kind === 'agent' || node.kind === 'user') {
    return (
      <AgentMark
        agent={{
          avatar_kind: mark.avatar_kind,
          avatar_icon: mark.avatar_icon,
          avatar_color: mark.avatar_color,
          avatar_shape: mark.avatar_shape,
          avatar_image_url: mark.avatar_image_url,
          name: mark.name || node.label,
        }}
        size={size}
        mode={live && node.kind === 'agent' ? 'live' : 'static'}
        decorative
        fallbackName={node.label}
      />
    )
  }
  if (node.kind === 'label' || node.kind === 'flow') {
    const Icon = labelMarkIcon(mark.icon) ?? (node.kind === 'flow' ? Route : Hash)
    const ink = labelMarkInk(mark.color)
    return (
      <Icon
        className="shrink-0"
        style={{ width: size * 0.72, height: size * 0.72, color: ink?.ink }}
        strokeWidth={1.75}
      />
    )
  }
  if (node.kind === 'channel' && mark.channel) {
    return <ChannelGlyph channel={mark.channel} size={size} />
  }
  if (node.kind === 'organization') {
    const image = (mark.avatar_image_url || '').trim() || DEFAULT_BRAND_MARK
    return (
      <img
        src={image}
        alt=""
        className="rounded-full object-contain"
        style={{ width: size, height: size }}
      />
    )
  }
  if (node.kind === 'calendar' || node.kind === 'connection' || node.kind === 'module') {
    const slug = hostSlugForProvider(mark.provider || '')
    const asset = BRAND_ASSETS[slug] ?? BRAND_ASSETS[mark.provider || '']
    if (asset) {
      return (
        <img
          src={asset.logoUrl}
          alt=""
          className="object-contain"
          style={{ width: size * 0.85, height: size * 0.85 }}
        />
      )
    }
  }
  const Icon = KIND_ICON[node.kind] ?? Hash
  return (
    <Icon
      className="shrink-0 text-text-secondary"
      style={{ width: size * 0.72, height: size * 0.72 }}
      strokeWidth={1.75}
    />
  )
}

export const ORG_KIND_ORDER = [
  'organization',
  'department',
  'user',
  'agent',
  'channel',
  'flow',
  'label',
  'folder',
  'calendar',
  'connection',
  'module',
  'doc',
  'source',
  'webhook',
] as const
