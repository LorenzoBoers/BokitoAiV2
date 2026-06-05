import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { Label } from '../ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select'
import { createCanvasNode, type OsCanvasNode, type OsNodeType } from '../../lib/os-api'
import { listProjects } from '../../lib/projects-api'
import { listProjectWorkstreams } from '../../lib/workstreams-api'
import { getAgents } from '../../lib/workforce-api'
import { useAuth } from '../../context/AuthContext'

type EntityOption = { refId: string; label: string }

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  canvasNodes: OsCanvasNode[]
  onAdded: () => void
  defaultPosition?: { x: number; y: number }
}

const NODE_TYPES: OsNodeType[] = ['orchestrator', 'workstream', 'repo', 'tool', 'blueprint']

const EMPTY_HINTS: Partial<Record<OsNodeType, { message: string; link?: { to: string; label: string } }>> = {
  tool: {
    message: 'Connect an MCP server or integration first, then add it to the canvas.',
    link: { to: '/integrations/connected', label: 'Open integrations' },
  },
  blueprint: {
    message: 'Blueprint is added automatically when your workspace has blueprint pages.',
    link: { to: '/os/docs', label: 'Open Blueprint' },
  },
}

async function loadEntities(
  nodeType: OsNodeType,
  token?: string,
): Promise<EntityOption[]> {
  if (nodeType === 'orchestrator') {
    const agents = await getAgents(token)
    return agents
      .filter((a) => ['po', 'orchestrator', 'orchestra', 'manager'].includes(a.role_slug ?? ''))
      .map((a) => ({ refId: a.id, label: a.name }))
  }
  if (nodeType === 'workstream') {
    const projects = await listProjects()
    const options: EntityOption[] = []
    for (const p of projects) {
      const { items } = await listProjectWorkstreams(p.id)
      for (const ws of items) {
        options.push({ refId: ws.id, label: `${p.name} / ${ws.name}` })
      }
    }
    return options
  }
  if (nodeType === 'repo') {
    const projects = await listProjects()
    return projects.map((p) => ({
      refId: p.id,
      label: p.github_repo_full_name ?? p.name,
    }))
  }
  return []
}

export default function OsAddNodePalette({
  open,
  onOpenChange,
  canvasNodes,
  onAdded,
  defaultPosition = { x: 240, y: 180 },
}: Props) {
  const { t } = useTranslation('aios')
  const { token } = useAuth()
  const [nodeType, setNodeType] = useState<OsNodeType>('workstream')
  const [entities, setEntities] = useState<EntityOption[]>([])
  const [refId, setRefId] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)

  const onCanvas = useCallback(
    (type: OsNodeType, id: string) =>
      canvasNodes.some((n) => n.node_type === type && n.ref_id === id),
    [canvasNodes],
  )

  useEffect(() => {
    if (!open) return
    setLoading(true)
    void loadEntities(nodeType, token)
      .then((rows) => {
        const available = rows.filter((r) => !onCanvas(nodeType, r.refId))
        setEntities(available)
        setRefId(available[0]?.refId ?? '')
      })
      .finally(() => setLoading(false))
  }, [open, nodeType, token, onCanvas])

  async function handleAdd() {
    if (!refId) return
    setBusy(true)
    try {
      await createCanvasNode(
        {
          node_type: nodeType,
          ref_id: refId,
          x: defaultPosition.x + canvasNodes.length * 24,
          y: defaultPosition.y + canvasNodes.length * 24,
        },
        token,
      )
      toast.success(t('palette.added', { defaultValue: 'Added to canvas' }))
      onAdded()
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('palette.title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t('palette.nodeType')}</Label>
            <Select value={nodeType} onValueChange={(v) => setNodeType(v as OsNodeType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {NODE_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {t(`nodes.${type === 'repo' ? 'source' : type}`, { defaultValue: type })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t('palette.entity')}</Label>
            {loading ? (
              <p className="text-sm text-text-muted">{t('palette.loading')}</p>
            ) : entities.length === 0 ? (
              <div className="space-y-2 rounded-lg border border-dashed border-border/60 p-3">
                <p className="text-sm text-text-muted">
                  {EMPTY_HINTS[nodeType]?.message ?? t('palette.empty')}
                </p>
                {EMPTY_HINTS[nodeType]?.link ? (
                  <Link
                    to={EMPTY_HINTS[nodeType]!.link!.to}
                    className="text-sm text-accent hover:underline"
                    onClick={() => onOpenChange(false)}
                  >
                    {EMPTY_HINTS[nodeType]!.link!.label}
                  </Link>
                ) : nodeType === 'workstream' ? (
                  <Link
                    to="/projects/new"
                    className="text-sm text-accent hover:underline"
                    onClick={() => onOpenChange(false)}
                  >
                    {t('palette.createProject', { defaultValue: 'Create a project' })}
                  </Link>
                ) : null}
              </div>
            ) : (
              <Select value={refId} onValueChange={setRefId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {entities.map((e) => (
                    <SelectItem key={e.refId} value={e.refId}>
                      {e.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <Button type="button" className="w-full" disabled={!refId || busy} onClick={() => void handleAdd()}>
            <Plus size={14} className="mr-1.5" />
            {t('palette.add')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function OsAddNodeTrigger({
  onClick,
}: {
  onClick: () => void
}) {
  const { t } = useTranslation('aios')
  return (
    <Button type="button" size="sm" variant="outline" onClick={onClick}>
      <Plus size={14} className="mr-1.5" />
      {t('palette.addNode')}
    </Button>
  )
}
