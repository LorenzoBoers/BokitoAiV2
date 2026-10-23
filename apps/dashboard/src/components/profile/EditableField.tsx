import { useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Pencil, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../ui/button'
import { Input } from '../ui/input'

/** One profile row: label left, value right, inline edit on click. */
export function EditableField({
  label,
  value,
  onSave,
  type = 'text',
}: {
  label: string
  value: string
  placeholder?: string
  onSave: (next: string) => Promise<void>
  type?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const { t } = useTranslation('profile')

  const startEdit = () => {
    setDraft(value)
    setEditing(true)
    setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 0)
  }

  const cancel = () => {
    setEditing(false)
    setDraft(value)
  }

  const save = async () => {
    if (draft === value) { setEditing(false); return }
    setSaving(true)
    try {
      await onSave(draft)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      setEditing(false)
    } catch (err) {
      // Keep edit mode open so the user does not mistake a failure for a save.
      toast.error(err instanceof Error ? err.message : t('errors.saveField', { label: label.toLowerCase() }))
    } finally {
      setSaving(false)
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') void save()
    if (e.key === 'Escape') cancel()
  }

  return (
    <div className="group flex items-center gap-4 border-b border-border py-3.5 pr-4 last:border-b-0">
      <span className="w-36 shrink-0 text-sm font-medium text-text-heading">{label}</span>

      {editing ? (
        <div className="flex flex-1 items-center justify-end gap-2">
          <Input
            ref={inputRef}
            type={type}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            className="h-8 w-52"
            autoComplete="off"
          />
          <Button
            size="iconSm"
            onClick={() => void save()}
            disabled={saving}
            aria-label={t('personalInformation.saveField', { label })}
          >
            <Check size={14} />
          </Button>
          <Button
            variant="secondary"
            size="iconSm"
            onClick={cancel}
            aria-label={t('personalInformation.cancelEdit')}
          >
            <X size={14} />
          </Button>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-end gap-2">
          {saved && <Check size={14} className="text-status-success" />}
          <button
            type="button"
            onClick={startEdit}
            className={`max-w-[16rem] truncate text-right text-sm ${value ? 'text-text-primary' : 'text-text-muted'}`}
          >
            {value || t('personalInformation.emptyValue')}
          </button>
          <Button
            variant="ghost"
            size="iconSm"
            onClick={startEdit}
            aria-label={t('personalInformation.editField', { label })}
            className="text-text-muted"
          >
            <Pencil size={14} />
          </Button>
        </div>
      )}
    </div>
  )
}
