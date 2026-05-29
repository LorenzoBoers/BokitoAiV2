import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { slugifyPageTitle } from '../../lib/doc-blocks'
import { createProjectWorkstream, type ProjectWorkstreamRow } from '../../lib/workstreams-api'
import { useProjectHubNav } from '../../context/ProjectHubNavContext'

function uniqueSlug(base: string, existingSlugs: Set<string>): string {
  if (!existingSlugs.has(base)) return base
  let index = 2
  while (existingSlugs.has(`${base}-${index}`)) index += 1
  return `${base}-${index}`
}

type AddWorkstreamDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  onCreated?: (stream: ProjectWorkstreamRow) => void
}

export default function AddWorkstreamDialog({
  open,
  onOpenChange,
  projectId,
  onCreated,
}: AddWorkstreamDialogProps) {
  const { t } = useTranslation('nav')
  const navigate = useNavigate()
  const { workstreams, refreshWorkstreams } = useProjectHubNav()
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const existingSlugs = useMemo(() => new Set(workstreams.map((stream) => stream.slug)), [workstreams])

  useEffect(() => {
    if (!open) {
      setName('')
      setError(null)
      setLoading(false)
    }
  }, [open])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return

    setLoading(true)
    setError(null)
    try {
      const slug = uniqueSlug(slugifyPageTitle(trimmed), existingSlugs)
      const created = await createProjectWorkstream(projectId, {
        name: trimmed,
        slug,
        status: 'draft',
        position: workstreams.length,
      })
      await refreshWorkstreams()
      onCreated?.(created)
      onOpenChange(false)
      navigate(`/project/${projectId}/overview?stream=${encodeURIComponent(created.slug)}`)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('backgroundWorkers.addStreamError', { defaultValue: 'Could not create workstream' }),
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t('backgroundWorkers.addStreamTitle', { defaultValue: 'New workstream' })}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="workstream-name">
              {t('backgroundWorkers.addStreamNameLabel', { defaultValue: 'Name' })}
            </Label>
            <Input
              id="workstream-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('backgroundWorkers.addStreamNamePlaceholder', {
                defaultValue: 'e.g. Content refresh',
              })}
              autoFocus
              disabled={loading}
            />
          </div>
          {error ? <p className="text-sm text-status-error">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
              {t('backgroundWorkers.addStreamCancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button type="submit" disabled={loading || !name.trim()}>
              {loading
                ? t('backgroundWorkers.addStreamSubmitting', { defaultValue: 'Creating…' })
                : t('backgroundWorkers.addStreamSubmit', { defaultValue: 'Create workstream' })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
