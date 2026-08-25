import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import {
  createSavedReply,
  deleteSavedReply,
  listSavedReplies,
  updateSavedReply,
  type SavedReplyRow,
} from '../../lib/signals-api'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { Input } from '../ui/input'

/** Settings card: manage the workspace's saved replies (canned responses). */
export default function SavedRepliesManager() {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const [rows, setRows] = useState<SavedReplyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | 'new' | null>(null)
  const [title, setTitle] = useState('')
  const [bodyText, setBodyText] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    void listSavedReplies(token)
      .then((data) => {
        if (!cancelled) setRows(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : t('savedReplies.loadFailed'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [token, t])

  const startEdit = useCallback((row: SavedReplyRow | null) => {
    setEditingId(row ? row.id : 'new')
    setTitle(row?.title ?? '')
    setBodyText(row?.bodyText ?? '')
  }, [])

  const cancelEdit = useCallback(() => {
    setEditingId(null)
    setTitle('')
    setBodyText('')
  }, [])

  const handleSave = useCallback(async () => {
    if (!token || !title.trim() || !bodyText.trim()) return
    setSaving(true)
    setError(null)
    try {
      if (editingId === 'new') {
        const created = await createSavedReply(token, { title, bodyText })
        if (created) setRows((prev) => [...prev, created])
      } else if (editingId) {
        const updated = await updateSavedReply(token, editingId, { title, bodyText })
        if (updated) setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
      }
      cancelEdit()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('savedReplies.saveFailed'))
    } finally {
      setSaving(false)
    }
  }, [token, editingId, title, bodyText, cancelEdit, t])

  const handleDelete = useCallback(
    async (row: SavedReplyRow) => {
      if (!token) return
      if (!window.confirm(t('savedReplies.deleteConfirm', { title: row.title }))) return
      try {
        await deleteSavedReply(token, row.id)
        setRows((prev) => prev.filter((r) => r.id !== row.id))
      } catch (err) {
        setError(err instanceof Error ? err.message : t('savedReplies.deleteFailed'))
      }
    },
    [token, t],
  )

  return (
    <Card id="saved-replies" className="overflow-hidden p-0">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div>
          <p className="text-sm font-medium text-text-heading">{t('savedReplies.title')}</p>
          <p className="text-xs text-text-secondary">
            {t('savedReplies.description')}
          </p>
        </div>
        {editingId === null ? (
          <Button size="sm" variant="secondary" onClick={() => startEdit(null)}>
            <Plus size={13} />
            {t('savedReplies.newReply')}
          </Button>
        ) : null}
      </div>
      <div className="divide-y divide-border/40">
        {error ? <p className="px-4 py-2 text-xs text-status-error">{error}</p> : null}
        {loading ? (
          <p className="px-4 py-4 text-xs text-text-muted">{t('savedReplies.loading')}</p>
        ) : rows.length === 0 && editingId === null ? (
          <div className="px-4 py-4">
            <p className="text-xs text-text-muted">
              {t('savedReplies.empty')}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => startEdit(null)}>
                <Plus size={13} />
                {t('savedReplies.newReply')}
              </Button>
              <Link
                to="/communication/inbox/all"
                className="text-[12px] font-medium text-accent hover:underline"
              >
                {t('savedReplies.openCommunication')}
              </Link>
            </div>
          </div>
        ) : null}
        {rows.map((row) =>
          editingId === row.id ? null : (
            <div key={row.id} className="flex items-start gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-text-heading">{row.title}</p>
                <p className="line-clamp-2 text-xs text-text-secondary">{row.bodyText}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button size="sm" variant="ghost" aria-label={t('savedReplies.editAria')} onClick={() => startEdit(row)}>
                  <Pencil size={13} />
                </Button>
                <Button size="sm" variant="ghost" aria-label={t('savedReplies.deleteAria')} onClick={() => void handleDelete(row)}>
                  <Trash2 size={13} />
                </Button>
              </div>
            </div>
          ),
        )}
        {editingId !== null ? (
          <div className="space-y-2 px-4 py-3">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('savedReplies.titlePlaceholder')}
              className="h-8 text-sm"
            />
            <textarea
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              placeholder={t('savedReplies.bodyPlaceholder')}
              rows={4}
              className="w-full resize-y rounded-md border border-border bg-bg-surface px-2.5 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent/50 focus:outline-none"
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="secondary" disabled={saving} onClick={cancelEdit}>
                {t('savedReplies.cancel')}
              </Button>
              <Button size="sm" disabled={saving || !title.trim() || !bodyText.trim()} onClick={() => void handleSave()}>
                {saving ? t('savedReplies.saving') : t('savedReplies.save')}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </Card>
  )
}
