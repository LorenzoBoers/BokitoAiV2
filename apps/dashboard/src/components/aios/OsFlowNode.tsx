import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import {
  BookOpen,
  Bot,
  FolderGit2,
  GitBranch,
  Plug,
  type LucideIcon,
} from 'lucide-react'
import NodeCard, { type OsNodeKind } from './NodeCard'
import type { OsCanvasNode, OsNodeType } from '../../lib/os-api'

export type OsFlowNodeData = {
  node: OsCanvasNode
  selected: boolean
  onSelect: (node: OsCanvasNode) => void
  pendingDraft?: boolean
}

const TYPE_META: Record<
  OsNodeType,
  { kind: OsNodeKind; icon: LucideIcon; accent: string }
> = {
  orchestrator: { kind: 'orchestrator', icon: Bot, accent: '#8b5cf6' },
  workstream: { kind: 'workstream', icon: GitBranch, accent: '#6366f1' },
  repo: { kind: 'source', icon: FolderGit2, accent: '#22c55e' },
  tool: { kind: 'tool', icon: Plug, accent: '#f59e0b' },
  blueprint: { kind: 'blueprint', icon: BookOpen, accent: '#0ea5e9' },
}

function statusTone(
  status: string,
): 'default' | 'active' | 'warning' | 'muted' {
  const s = status.toLowerCase()
  if (['active', 'linked', 'ready', 'running'].includes(s)) return 'active'
  if (['paused', 'setup', 'pending', 'warning'].includes(s)) return 'warning'
  if (['idle', 'draft', 'empty', 'none', 'inactive', 'standby', 'shared'].includes(s))
    return 'muted'
  return 'default'
}

function OsFlowNodeComponent({ data }: NodeProps) {
  const payload = data as OsFlowNodeData
  const { node, selected, onSelect, pendingDraft } = payload
  const meta = TYPE_META[node.node_type]

  return (
    <div className="relative">
      {pendingDraft ? (
        <span className="absolute -top-2 right-0 z-10 rounded bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-medium text-white">
          Draft
        </span>
      ) : null}
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !border-accent/40 !bg-accent/30" />
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-accent/40 !bg-accent/30" />
      <NodeCard
        kind={meta.kind}
        title={node.title}
        subtitle={node.subtitle}
        statusLabel={node.status}
        statusTone={statusTone(node.status)}
        icon={meta.icon}
        accentColor={meta.accent}
        onClick={() => onSelect(node)}
        className={selected ? 'ring-2 ring-accent/50' : undefined}
        data-testid={`os-flow-node-${node.id}`}
      />
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !border-accent/40 !bg-accent/30" />
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-accent/40 !bg-accent/30" />
    </div>
  )
}

export default memo(OsFlowNodeComponent)
