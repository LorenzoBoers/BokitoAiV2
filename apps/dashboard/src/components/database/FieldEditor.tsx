import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Loader2, Trash2, GripVertical } from 'lucide-react'
import { useDatabase } from '../../context/DatabaseContext'
import type { FieldType, FieldConfig, DefaultValue } from '../../types/custom-db'
import { FIELD_TYPE_META } from '../../types/custom-db'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import FieldTypeSelector from './FieldTypeSelector'
import FieldConfigPanel from './FieldConfigPanel'
import ConfirmDeleteDialog from '../ui/ConfirmDeleteDialog'

export default function FieldEditor() {
  const { fields, removeField, editField } = useDatabase()
  const [showAdd, setShowAdd] = useState(false)
  const [draggingFieldId, setDraggingFieldId] = useState<number | null>(null)
  const [overFieldId, setOverFieldId] = useState<number | null>(null)
  const [savingOrder, setSavingOrder] = useState(false)
  const [deleteFieldId, setDeleteFieldId] = useState<number | null>(null)
  const [deletingField, setDeletingField] = useState(false)
  const dragStartOrderRef = useRef<number[] | null>(null)
  const dragDidDropRef = useRef(false)

  const sortedFields = useMemo(
    () => [...fields].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
    [fields],
  )
  const [orderedIds, setOrderedIds] = useState<number[]>([])

  useEffect(() => {
    setOrderedIds(sortedFields.map((f) => f.id))
  }, [sortedFields])

  const orderedFields = useMemo(
    () => orderedIds
      .map((id) => sortedFields.find((f) => f.id === id))
      .filter((f): f is (typeof sortedFields)[number] => Boolean(f)),
    [orderedIds, sortedFields],
  )
  const fieldToDelete = useMemo(
    () => orderedFields.find((field) => field.id === deleteFieldId) ?? null,
    [orderedFields, deleteFieldId],
  )

  const persistOrder = async (ids: number[]) => {
    setSavingOrder(true)
    try {
      const idToField = new Map(sortedFields.map((f) => [f.id, f]))
      await Promise.all(
        ids.map(async (id, index) => {
          const field = idToField.get(id)
          if (!field) return
          const nextPosition = index + 1
          if (field.position === nextPosition) return
          await editField(id, { position: nextPosition })
        }),
      )
    } finally {
      setSavingOrder(false)
    }
  }

  const moveField = (dragId: number, targetId: number) => {
    if (dragId === targetId) return
    setOrderedIds((prev) => {
      const from = prev.indexOf(dragId)
      const to = prev.indexOf(targetId)
      if (from < 0 || to < 0) return prev
      const next = [...prev]
      next.splice(from, 1)
      next.splice(to, 0, dragId)
      void persistOrder(next)
      return next
    })
  }

  const previewMoveField = (dragId: number, targetId: number) => {
    if (dragId === targetId) return
    setOrderedIds((prev) => {
      const from = prev.indexOf(dragId)
      const to = prev.indexOf(targetId)
      if (from < 0 || to < 0) return prev
      const next = [...prev]
      next.splice(from, 1)
      next.splice(to, 0, dragId)
      return next
    })
  }

  const handleDeleteField = async () => {
    if (!fieldToDelete) return
    setDeletingField(true)
    try {
      await removeField(fieldToDelete.id)
      setDeleteFieldId(null)
    } finally {
      setDeletingField(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-text-heading uppercase tracking-wide">Velden</span>
        <Button size="sm" variant="ghost" className="h-6 text-xs gap-1" onClick={() => setShowAdd(true)}>
          <Plus size={12} /> Veld
        </Button>
      </div>

      <div className="space-y-0.5">
        {orderedFields.map((field) => (
          <div
            key={field.id}
            draggable
            onDragStart={() => {
              setDraggingFieldId(field.id)
              dragStartOrderRef.current = orderedIds
              dragDidDropRef.current = false
            }}
            onDragEnter={() => setOverFieldId(field.id)}
            onDragOver={(event) => {
              event.preventDefault()
              setOverFieldId(field.id)
              if (draggingFieldId !== null && draggingFieldId !== field.id) {
                previewMoveField(draggingFieldId, field.id)
              }
            }}
            onDragEnd={() => {
              if (!dragDidDropRef.current && dragStartOrderRef.current) {
                setOrderedIds(dragStartOrderRef.current)
              }
              dragStartOrderRef.current = null
              dragDidDropRef.current = false
              setDraggingFieldId(null)
              setOverFieldId(null)
            }}
            onDrop={(event) => {
              event.preventDefault()
              if (draggingFieldId === null) return
              dragDidDropRef.current = true
              if (draggingFieldId !== field.id) {
                moveField(draggingFieldId, field.id)
              } else {
                void persistOrder(orderedIds)
              }
              setDraggingFieldId(null)
              setOverFieldId(null)
            }}
            className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-xs group transition-colors ${
              overFieldId === field.id ? 'bg-accent/10' : 'hover:bg-bg-hover'
            } ${draggingFieldId === field.id ? 'opacity-50' : ''} transition-all duration-150`}
          >
            <GripVertical size={12} className="text-text-muted flex-shrink-0 cursor-grab" />
            <span className="text-text-primary flex-1 truncate">{field.name}</span>
            <span className="text-text-muted text-[10px] px-1.5 py-0.5 bg-bg-hover rounded">
              {FIELD_TYPE_META[field.field_type]?.label ?? field.field_type}
            </span>
            <button
              type="button"
              onClick={() => setDeleteFieldId(field.id)}
              disabled={savingOrder}
              className="opacity-0 group-hover:opacity-100 p-0.5 text-text-muted hover:text-status-error transition-opacity"
            >
              <Trash2 size={11} />
            </button>
          </div>
        ))}
        {savingOrder ? (
          <div className="px-2 py-1 text-[10px] text-text-muted">Volgorde opslaan...</div>
        ) : null}
      </div>

      {showAdd && <AddFieldDialog onClose={() => setShowAdd(false)} />}
      {fieldToDelete ? (
        <ConfirmDeleteDialog
          title="Veld verwijderen?"
          itemLabel="het veld"
          itemName={fieldToDelete.name}
          impactText="Records verliezen de data in dit veld. Deze wijziging kan niet ongedaan worden gemaakt."
          isDeleting={deletingField}
          onCancel={() => setDeleteFieldId(null)}
          onConfirm={handleDeleteField}
        />
      ) : null}
    </div>
  )
}

function AddFieldDialog({ onClose }: { onClose: () => void }) {
  const { addField } = useDatabase()
  const [step, setStep] = useState<'type' | 'config'>('type')
  const [name, setName] = useState('')
  const [fieldType, setFieldType] = useState<FieldType | null>(null)
  const [config, setConfig] = useState<FieldConfig>({})
  const [required, setRequired] = useState(false)
  const [defaultValue, setDefaultValue] = useState<DefaultValue | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleTypeSelect = (ft: FieldType) => {
    setFieldType(ft)
    setConfig({})
    setStep('config')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!fieldType || !name.trim()) return
    setSaving(true)
    setError(null)
    try {
      await addField({ 
        name: name.trim(), 
        field_type: fieldType, 
        config, 
        required, 
        default_value: defaultValue 
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fout bij aanmaken')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[1px] flex items-center justify-center p-4">
      <Card className="w-full max-w-md max-h-[90vh] overflow-y-auto">
        <CardHeader>
          <CardTitle>{step === 'type' ? 'Kies veldtype' : 'Veld configureren'}</CardTitle>
        </CardHeader>
        <CardContent>
          {step === 'type' ? (
            <div className="space-y-3">
              <FieldTypeSelector onChange={handleTypeSelect} />
              <div className="flex justify-end">
                <Button variant="ghost" onClick={onClose}>Annuleren</Button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-medium text-text-secondary mb-1 block">Veldnaam</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Bijv. Status, Bedrag..." autoFocus />
              </div>

              <div className="text-xs text-text-muted">
                Type: <strong className="text-text-primary">{fieldType ? FIELD_TYPE_META[fieldType].label : ''}</strong>
                <button type="button" className="ml-2 text-accent hover:underline" onClick={() => setStep('type')}>
                  Wijzig
                </button>
              </div>

              {fieldType && (
                <FieldConfigPanel 
                  fieldType={fieldType} 
                  config={config} 
                  onChange={setConfig}
                  defaultValue={defaultValue}
                  onDefaultValueChange={setDefaultValue}
                />
              )}

              <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
                <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} className="rounded" />
                Verplicht veld
              </label>

              {error && <p className="text-xs text-status-error">{error}</p>}

              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Annuleren</Button>
                <Button type="submit" disabled={saving || !name.trim()}>
                  {saving && <Loader2 size={14} className="animate-spin mr-1" />}
                  Toevoegen
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
