import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Code2,
  FileSpreadsheet,
  Folder,
  GitBranch,
  Globe,
  Link2,
  Loader2,
  NotebookText,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import {
  createProjectResource,
  deleteProjectResource,
  listProjectResources,
  type ProjectResourceRow,
  type ResourceType,
} from '../../lib/project-work-api'

const RESOURCE_TYPES: ResourceType[] = ['repo', 'drive', 'notion', 'sheet', 'vibecode', 'site', 'other']

const TYPE_ICON: Record<ResourceType, typeof Folder> = {
  repo: GitBranch,
  drive: Folder,
  notion: NotebookText,
  sheet: FileSpreadsheet,
  vibecode: Code2,
  site: Globe,
  other: Link2,
}

const STATUS_VARIANT: Record<string, 'neutral' | 'success' | 'warning' | 'error' | 'info'> = {
  linked: 'neutral',
  connected: 'success',
  syncing: 'info',
  error: 'error',
  disconnected: 'warning',
}

/**
 * Generic external surfaces a project operates on. The repo resource is
 * managed by the Repository card (connect/index flows); other slots are
 * "linked" by reference now and gain connectors later.
 */
export function ProjectResourcesSection({
  projectId,
  canEdit,
}: {
  projectId: string
  canEdit: boolean
}) {
  const { t } = useTranslation('nav')
  const [resources, setResources] = useState<ProjectResourceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [newType, setNewType] = useState<ResourceType>('drive')
  const [newLabel, setNewLabel] = useState('')
  const [newRef, setNewRef] = useState('')

  const load = useCallback(async () => {
    try {
      setResources(await listProjectResources(projectId))
    } catch {
      setResources([])
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  const add = async () => {
    if (!newRef.trim() && !newLabel.trim()) return
    setBusy(true)
    try {
      await createProjectResource(projectId, {
        resource_type: newType,
        label: newLabel.trim(),
        external_ref: newRef.trim(),
      })
      setNewLabel('')
      setNewRef('')
      setAdding(false)
      toast.success(t('projects.work.resourceLinked'))
      void load()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('projects.work.resourceLinkError')))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (resource: ProjectResourceRow) => {
    setBusy(true)
    try {
      await deleteProjectResource(projectId, resource.id)
      toast.success(t('projects.work.resourceRemoved'))
      void load()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('projects.work.resourceRemoveError')))
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <p className="text-sm text-text-muted">{t('projects.work.resourcesLoading')}</p>
  }

  return (
    <div className="space-y-2">
      {resources.length === 0 ? (
        <p className="text-sm text-text-muted">{t('projects.work.resourcesEmpty')}</p>
      ) : (
        <ul className="space-y-1.5">
          {resources.map((resource) => {
            const Icon = TYPE_ICON[resource.resource_type] ?? Link2
            return (
              <li
                key={resource.id}
                className="flex items-center gap-2 rounded-md border border-border/50 px-2.5 py-1.5"
              >
                <Icon size={14} className="shrink-0 text-text-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-text-primary">
                    {resource.label || resource.external_ref || t(`projects.work.resourceType.${resource.resource_type}`)}
                  </span>
                  <span className="block truncate text-[11px] text-text-muted">
                    {t(`projects.work.resourceType.${resource.resource_type}`)}
                    {resource.provider ? ` · ${resource.provider}` : ''}
                    {resource.external_ref && resource.label ? ` · ${resource.external_ref}` : ''}
                  </span>
                </span>
                <Badge
                  variant={STATUS_VARIANT[resource.status] ?? 'neutral'}
                  className="px-1.5 py-0 text-[10px]"
                >
                  {t(`projects.work.resourceStatus.${resource.status}`, {
                    defaultValue: resource.status,
                  })}
                </Badge>
                {canEdit && resource.resource_type !== 'repo' ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 px-1.5 text-text-muted hover:text-status-error"
                    disabled={busy}
                    title={t('projects.work.resourceRemove')}
                    onClick={() => void remove(resource)}
                  >
                    <Trash2 size={12} />
                  </Button>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}

      {canEdit ? (
        adding ? (
          <div className="space-y-2 rounded-md border border-border/50 p-2.5">
            <div className="flex flex-wrap gap-2">
              <Select value={newType} onValueChange={(v) => setNewType(v as ResourceType)}>
                <SelectTrigger className="h-8 w-32 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RESOURCE_TYPES.filter((type) => type !== 'repo').map((type) => (
                    <SelectItem key={type} value={type}>
                      {t(`projects.work.resourceType.${type}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder={t('projects.work.resourceLabelPlaceholder')}
                className="h-8 min-w-36 flex-1 text-sm"
              />
            </div>
            <Input
              value={newRef}
              onChange={(e) => setNewRef(e.target.value)}
              placeholder={t('projects.work.resourceRefPlaceholder')}
              className="h-8 text-sm"
            />
            <p className="text-[11px] text-text-muted">{t('projects.work.resourceHint')}</p>
            <div className="flex justify-end gap-1.5">
              <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => setAdding(false)}>
                <X size={12} className="mr-1" />
                {t('projects.work.cancel')}
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-7"
                disabled={busy || (!newRef.trim() && !newLabel.trim())}
                onClick={() => void add()}
              >
                {busy ? <Loader2 size={12} className="mr-1 animate-spin" /> : <Plus size={12} className="mr-1" />}
                {t('projects.work.resourceAdd')}
              </Button>
            </div>
          </div>
        ) : (
          <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus size={13} className="mr-1" />
            {t('projects.work.resourceAddLink')}
          </Button>
        )
      ) : null}
    </div>
  )
}
