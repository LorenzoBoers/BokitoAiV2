import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { PackageCheck } from 'lucide-react'
import { Button } from '../ui/button'
import { ChoiceSelect } from '../ui/ChoiceSelect'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { patchWorkstream, type WorkstreamDetail } from '../../lib/flows-api'
import { listProjects, type ProjectRow } from '../../lib/projects-api'
import { listWorksIn, type WorksInItem } from '../../lib/project-work-api'

const FOLDER_ITSELF = '__folder__'

/** "Delivers to" under the flow name: where a ticket's work lands once it is done. */
export function FlowDestination({
  flow,
  canEdit,
  onSaved,
}: {
  flow: WorkstreamDetail
  canEdit: boolean
  onSaved: (updated: WorkstreamDetail) => void
}) {
  const { t } = useTranslation('nav')
  const dest = flow.deliver_to ?? null
  const [editing, setEditing] = useState(false)
  const [folders, setFolders] = useState<ProjectRow[]>([])
  const [folderId, setFolderId] = useState(dest?.folder_id ?? '')
  const [items, setItems] = useState<WorksInItem[]>([])
  const [itemKey, setItemKey] = useState(dest?.works_in_key || FOLDER_ITSELF)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!editing) return
    void listProjects().then(setFolders).catch(() => setFolders([]))
  }, [editing])

  useEffect(() => {
    if (!editing || !folderId) {
      setItems([])
      return
    }
    void listWorksIn(folderId).then(setItems).catch(() => setItems([]))
  }, [editing, folderId])

  const itemName = (kind: string, label: string) =>
    label || t(`projects.worksIn.kind.${kind}`, { defaultValue: kind })

  const save = async (nextFolder: string | null, nextKey: string) => {
    setSaving(true)
    try {
      const updated = await patchWorkstream(flow.id, {
        deliver_folder_id: nextFolder,
        deliver_works_in_key: nextKey === FOLDER_ITSELF ? '' : nextKey,
      })
      onSaved(updated)
      setEditing(false)
      toast.success(t('workstreamsPage.deliverTo.saved'))
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('workstreamsPage.deliverTo.saveError')))
    } finally {
      setSaving(false)
    }
  }

  if (!dest && !canEdit) return null

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary" data-testid="flow-destination">
      <PackageCheck size={14} className="shrink-0 text-text-muted" aria-hidden />
      <span className="font-medium">{t('workstreamsPage.deliverTo.label')}</span>
      {dest ? (
        /^https?:\/\//.test(dest.href) ? (
          <a href={dest.href} target="_blank" rel="noreferrer" className="hover:text-accent hover:underline">
            {dest.folder_name}
            {dest.works_in_key ? ` › ${itemName(dest.item_kind, dest.item_label)}` : ''}
          </a>
        ) : (
          <Link to={dest.href} className="hover:text-accent hover:underline">
            {dest.folder_name}
            {dest.works_in_key ? ` › ${itemName(dest.item_kind, dest.item_label)}` : ''}
          </Link>
        )
      ) : (
        <span className="text-text-muted">{t('workstreamsPage.deliverTo.none')}</span>
      )}
      {canEdit && !editing ? (
        <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setEditing(true)}>
          {dest ? t('workstreamsPage.deliverTo.change') : t('workstreamsPage.deliverTo.set')}
        </Button>
      ) : null}
      {canEdit && editing ? (
        <>
          <ChoiceSelect
            aria-label={t('workstreamsPage.deliverTo.folder')}
            placeholder={t('workstreamsPage.deliverTo.folder')}
            triggerClassName="h-7 w-48 text-xs"
            value={folderId}
            onValueChange={(value) => {
              setFolderId(value)
              setItemKey(FOLDER_ITSELF)
            }}
            disabled={saving}
            groups={[{ items: folders.map((f) => ({ value: f.id, label: f.name, kind: 'project' as const })) }]}
          />
          {folderId ? (
            <ChoiceSelect
              aria-label={t('workstreamsPage.deliverTo.item')}
              triggerClassName="h-7 w-48 text-xs"
              value={itemKey}
              onValueChange={setItemKey}
              disabled={saving}
              groups={[
                {
                  items: [
                    { value: FOLDER_ITSELF, label: t('workstreamsPage.deliverTo.folderItself'), kind: 'project' as const },
                    ...items.map((item) => ({
                      value: item.key,
                      label: itemName(item.kind, item.label),
                      kind: 'project' as const,
                    })),
                  ],
                },
              ]}
            />
          ) : null}
          <Button
            type="button"
            size="sm"
            className="h-7 text-xs"
            disabled={saving || !folderId}
            onClick={() => void save(folderId, itemKey)}
          >
            {t('workstreamsPage.deliverTo.save')}
          </Button>
          {dest ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              disabled={saving}
              onClick={() => void save(null, FOLDER_ITSELF)}
            >
              {t('workstreamsPage.deliverTo.clear')}
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            disabled={saving}
            onClick={() => setEditing(false)}
          >
            {t('workstreamsPage.deliverTo.cancel')}
          </Button>
        </>
      ) : null}
    </div>
  )
}
