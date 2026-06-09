import { useEffect, useRef, useState } from 'react'
import { Star, Upload } from 'lucide-react'
import type { CustomField, ValidationError } from '../../../types/custom-db'
import { Input } from '../../ui/input'
import { Textarea } from '../../ui/textarea'
import { Button } from '../../ui/button'
import { validateFieldValue } from '../../../lib/field-validation'
import { InlineValidationFeedback } from '../ValidationFeedback'
import { useDatabase } from '../../../context/DatabaseContext'
import RelationSearchModal from '../RelationSearchModal'

export default function CellEditor({
  field,
  value,
  onSave,
  onCancel,
  onNavigate,
}: {
  field: CustomField
  value: unknown
  onSave: (val: unknown) => void
  onCancel: () => void
  onNavigate: (direction: 'up' | 'down' | 'left' | 'right') => void
}) {
  switch (field.field_type) {
    case 'text':
    case 'email':
    case 'url':
    case 'phone':
      return <TextEditor value={String(value ?? '')} onSave={onSave} onCancel={onCancel} onNavigate={onNavigate} field={field} />

    case 'long_text':
      return <LongTextEditor value={String(value ?? '')} onSave={onSave} onCancel={onCancel} />

    case 'number':
    case 'currency':
      return <NumberEditor value={value as number | null} onSave={onSave} onCancel={onCancel} onNavigate={onNavigate} field={field} />

    case 'boolean':
      return <BoolEditor value={Boolean(value)} onSave={onSave} />

    case 'date':
      return <DateEditor value={String(value ?? '')} includeTime={field.config?.includeTime ?? false} onSave={onSave} onCancel={onCancel} onNavigate={onNavigate} />

    case 'select':
      return <SelectEditor options={field.config?.options ?? []} value={String(value ?? '')} onSave={onSave} onCancel={onCancel} />

    case 'multi_select':
      return (
        <MultiSelectEditor
          options={field.config?.options ?? []}
          value={Array.isArray(value) ? value : []}
          onSave={onSave}
          onCancel={onCancel}
        />
      )

    case 'rating':
      return <RatingEditor max={field.config?.max ?? 5} value={Number(value ?? 0)} onSave={onSave} />

    case 'relation':
      return <RelationEditor field={field} value={value} onSave={onSave} onCancel={onCancel} />

    case 'attachment':
      return <AttachmentEditor field={field} value={value} onSave={onSave} onCancel={onCancel} />

    case 'lookup':
    case 'formula':
      // Read-only fields
      return <div className="text-xs text-text-muted italic p-2">Dit veld is alleen-lezen</div>

    default:
      return <TextEditor value={String(value ?? '')} onSave={onSave} onCancel={onCancel} onNavigate={onNavigate} field={field} />
  }
}

function TextEditor({
  value,
  onSave,
  onCancel,
  onNavigate,
  field,
}: {
  value: string
  onSave: (v: unknown) => void
  onCancel: () => void
  onNavigate: (direction: 'up' | 'down' | 'left' | 'right') => void
  field?: CustomField
}) {
  const [draft, setDraft] = useState(value)
  const [errors, setErrors] = useState<ValidationError[]>([])
  const [showValidation, setShowValidation] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  
  useEffect(() => { 
    ref.current?.focus(); 
    ref.current?.select() 
  }, [])

  const validateAndSave = (val: string) => {
    if (field) {
      const validationErrors = validateFieldValue(field, val)
      setErrors(validationErrors)
      if (validationErrors.length > 0) {
        setShowValidation(true)
        return
      }
    }
    onSave(val)
  }

  const handleBlur = () => {
    if (field) {
      const validationErrors = validateFieldValue(field, draft)
      if (validationErrors.length > 0) {
        setErrors(validationErrors)
        setShowValidation(true)
        return
      }
    }
    onSave(draft)
  }

  return (
    <div className="relative">
      <Input
        ref={ref}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value)
          setShowValidation(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') validateAndSave(draft)
          if (e.key === 'Escape') onCancel()
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault()
            validateAndSave(draft)
            onNavigate(e.key === 'ArrowUp' ? 'up' : e.key === 'ArrowDown' ? 'down' : e.key === 'ArrowLeft' ? 'left' : 'right')
          }
        }}
        onBlur={handleBlur}
        className={`h-8 w-full border rounded-none bg-transparent text-xs px-1 focus-visible:ring-0 focus-visible:outline-none ${
          errors.length > 0 ? 'border-status-error/50 focus:border-status-error' : 'border-transparent focus:border-border/50'
        }`}
      />
      <InlineValidationFeedback errors={errors} show={showValidation} />
    </div>
  )
}

function NumberEditor({
  value,
  onSave,
  onCancel,
  onNavigate,
  field,
}: {
  value: number | null
  onSave: (v: unknown) => void
  onCancel: () => void
  onNavigate: (direction: 'up' | 'down' | 'left' | 'right') => void
  field?: CustomField
}) {
  const [draft, setDraft] = useState(value?.toString() ?? '')
  const [errors, setErrors] = useState<ValidationError[]>([])
  const [showValidation, setShowValidation] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  
  useEffect(() => { 
    ref.current?.focus(); 
    ref.current?.select() 
  }, [])

  const validateAndSave = (val: string) => {
    const numValue = val ? Number(val) : null
    if (field) {
      const validationErrors = validateFieldValue(field, numValue)
      setErrors(validationErrors)
      if (validationErrors.length > 0) {
        setShowValidation(true)
        return
      }
    }
    onSave(numValue)
  }

  const handleBlur = () => {
    const numValue = draft ? Number(draft) : null
    if (field) {
      const validationErrors = validateFieldValue(field, numValue)
      if (validationErrors.length > 0) {
        setErrors(validationErrors)
        setShowValidation(true)
        return
      }
    }
    onSave(numValue)
  }

  return (
    <div className="relative">
      <Input
        ref={ref}
        type="number"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value)
          setShowValidation(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') validateAndSave(draft)
          if (e.key === 'Escape') onCancel()
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault()
            validateAndSave(draft)
            onNavigate(e.key === 'ArrowUp' ? 'up' : e.key === 'ArrowDown' ? 'down' : e.key === 'ArrowLeft' ? 'left' : 'right')
          }
        }}
        onBlur={handleBlur}
        className={`h-8 w-full border rounded-none bg-transparent text-xs px-1 focus-visible:ring-0 focus-visible:outline-none ${
          errors.length > 0 ? 'border-status-error/50 focus:border-status-error' : 'border-transparent focus:border-border/50'
        }`}
      />
      <InlineValidationFeedback errors={errors} show={showValidation} />
    </div>
  )
}

function BoolEditor({ value, onSave }: { value: boolean; onSave: (v: unknown) => void }) {
  useEffect(() => { onSave(!value) }, [])
  return null
}

function DateEditor({
  value,
  includeTime,
  onSave,
  onCancel,
  onNavigate,
}: {
  value: string
  includeTime?: boolean
  onSave: (v: unknown) => void
  onCancel: () => void
  onNavigate: (direction: 'up' | 'down' | 'left' | 'right') => void
}) {
  const toInput = (v: string) => {
    if (!v) return ''
    const d = new Date(v)
    if (isNaN(d.getTime())) return v
    if (includeTime) return d.toISOString().slice(0, 16)
    return d.toISOString().slice(0, 10)
  }
  const [draft, setDraft] = useState(toInput(value))
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus() }, [])

  return (
    <Input
      ref={ref}
      type={includeTime ? 'datetime-local' : 'date'}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onSave(draft || null)
        if (e.key === 'Escape') onCancel()
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault()
          onSave(draft || null)
          onNavigate(e.key === 'ArrowUp' ? 'up' : e.key === 'ArrowDown' ? 'down' : e.key === 'ArrowLeft' ? 'left' : 'right')
        }
      }}
      onBlur={() => onSave(draft || null)}
      className="h-8 w-full border border-transparent rounded-none bg-transparent text-xs px-1 focus:border-border/50 focus-visible:ring-0 focus-visible:outline-none"
    />
  )
}

function SelectEditor({ options, value, onSave, onCancel }: {
  options: { value: string; label: string; color: string }[]
  value: string
  onSave: (v: unknown) => void
  onCancel: () => void
}) {
  return (
    <div
      className="absolute z-20 top-full left-0 mt-0.5 min-w-[160px] rounded-md border border-border bg-bg-elevated shadow-lg py-1 max-h-[200px] overflow-y-auto"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          onClick={(e) => {
            e.stopPropagation()
            onSave(opt.value)
          }}
          className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-bg-hover ${
            opt.value === value ? 'bg-accent/8 text-accent' : 'text-text-primary'
          }`}
        >
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: opt.color }} />
          {opt.label}
        </button>
      ))}
      <button
        type="button"
        onMouseDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
        onClick={(e) => {
          e.stopPropagation()
          onCancel()
        }}
        className="w-full text-center text-[10px] text-text-muted py-1 hover:bg-bg-hover"
      >
        Annuleren
      </button>
    </div>
  )
}

function MultiSelectEditor({ options, value, onSave, onCancel }: {
  options: { value: string; label: string; color: string }[]
  value: string[]
  onSave: (v: unknown) => void
  onCancel: () => void
}) {
  const [selected, setSelected] = useState<string[]>(value)

  const toggle = (v: string) => {
    setSelected((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v])
  }

  return (
    <div
      className="absolute z-20 top-full left-0 mt-0.5 min-w-[160px] rounded-md border border-border bg-bg-elevated shadow-lg py-1 max-h-[200px] overflow-y-auto"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          onClick={(e) => {
            e.stopPropagation()
            toggle(opt.value)
          }}
          className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-bg-hover ${
            selected.includes(opt.value) ? 'bg-accent/8' : ''
          } text-text-primary`}
        >
          <span className={`w-3 h-3 rounded border flex items-center justify-center text-[8px] ${
            selected.includes(opt.value) ? 'bg-accent border-accent text-white' : 'border-border'
          }`}>
            {selected.includes(opt.value) && '✓'}
          </span>
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: opt.color }} />
          {opt.label}
        </button>
      ))}
      <div className="flex justify-end px-2 pt-1 border-t border-border mt-1">
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          onClick={(e) => {
            e.stopPropagation()
            onCancel()
          }}
          className="text-[10px] text-text-muted px-2 py-0.5 hover:bg-bg-hover rounded mr-1"
        >
          Annuleren
        </button>
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          onClick={(e) => {
            e.stopPropagation()
            onSave(selected)
          }}
          className="text-[10px] text-accent font-medium px-2 py-0.5 hover:bg-accent/10 rounded"
        >
          OK
        </button>
      </div>
    </div>
  )
}

function RatingEditor({ max, value, onSave }: { max: number; value: number; onSave: (v: unknown) => void }) {
  return (
    <div className="flex gap-0.5 items-center h-full px-1">
      {Array.from({ length: max }, (_, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onSave(i + 1 === value ? 0 : i + 1)}
          className="p-0"
        >
          <Star size={14} className={i < value ? 'text-amber-400 fill-amber-400' : 'text-text-muted/30 hover:text-amber-300'} />
        </button>
      ))}
    </div>
  )
}

function LongTextEditor({
  value,
  onSave,
  onCancel,
}: {
  value: string
  onSave: (v: unknown) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { ref.current?.focus() }, [])

  return (
    <div className="absolute z-20 top-full left-0 mt-0.5 w-80 rounded-md border border-border bg-bg-elevated shadow-lg p-3">
      <Textarea
        ref={ref}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel()
          if (e.key === 'Enter' && e.ctrlKey) onSave(draft)
        }}
        placeholder="Voer tekst in..."
        className="text-xs min-h-[120px] resize-none"
        rows={6}
      />
      <div className="flex justify-end gap-2 mt-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Annuleren
        </Button>
        <Button type="button" size="sm" onClick={() => onSave(draft)}>
          Save
        </Button>
      </div>
      <div className="text-[10px] text-text-muted mt-1">
        Tip: Ctrl+Enter om op te slaan
      </div>
    </div>
  )
}

function RelationEditor({
  field,
  value,
  onSave,
  onCancel,
}: {
  field: CustomField
  value: unknown
  onSave: (v: unknown) => void
  onCancel: () => void
}) {
  const { tables } = useDatabase()
  const [showModal, setShowModal] = useState(true)
  
  const relatedTable = tables.find(t => t.id === field.config.tableId)
  
  if (!relatedTable) {
    return (
      <div className="text-xs text-status-error p-2">
        Gerelateerde tabel niet gevonden
      </div>
    )
  }

  const handleSelect = (selectedValue: number | number[]) => {
    onSave(selectedValue)
    setShowModal(false)
  }

  const handleClose = () => {
    setShowModal(false)
    onCancel()
  }

  return showModal ? (
    <RelationSearchModal
      field={field}
      relatedTable={relatedTable}
      value={value}
      onSelect={handleSelect}
      onClose={handleClose}
    />
  ) : null
}

function AttachmentEditor({
  field,
  onSave,
  onCancel,
}: {
  field: CustomField
  value?: unknown
  onSave: (v: unknown) => void
  onCancel: () => void
}) {
  const [files, setFiles] = useState<File[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { maxFiles = 10, maxFileSize = 25, accept } = field.config

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || [])
    
    // Validate file size
    const oversizedFiles = selectedFiles.filter(file => file.size > maxFileSize * 1024 * 1024)
    if (oversizedFiles.length > 0) {
      alert(`Sommige bestanden zijn te groot. Maximum: ${maxFileSize}MB`)
      return
    }
    
    // Validate file count
    if (selectedFiles.length > maxFiles) {
      alert(`Te veel bestanden geselecteerd. Maximum: ${maxFiles}`)
      return
    }
    
    setFiles(selectedFiles)
  }

  const handleUpload = () => {
    // In a real implementation, you would upload files to a server
    // For now, we'll just save the file names
    const fileNames = files.map(file => file.name)
    onSave(fileNames)
  }

  return (
    <div className="absolute z-20 top-full left-0 mt-0.5 w-64 rounded-md border border-border bg-bg-elevated shadow-lg p-3">
      <div className="space-y-3">
        <div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={accept?.join(',') || '*'}
            onChange={handleFileSelect}
            className="hidden"
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            className="w-full"
          >
            <Upload size={14} className="mr-2" />
            Bestanden selecteren
          </Button>
        </div>
        
        {files.length > 0 && (
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {files.map((file, idx) => (
              <div key={idx} className="text-xs p-2 bg-bg-hover rounded flex justify-between items-center">
                <span className="truncate">{file.name}</span>
                <span className="text-text-muted ml-2">{(file.size / 1024 / 1024).toFixed(1)}MB</span>
              </div>
            ))}
          </div>
        )}
        
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Annuleren
          </Button>
          <Button 
            type="button" 
            size="sm" 
            onClick={handleUpload}
            disabled={files.length === 0}
          >
            Uploaden
          </Button>
        </div>
        
        <div className="text-[10px] text-text-muted">
          Max {maxFiles} bestanden, {maxFileSize}MB per bestand
        </div>
      </div>
    </div>
  )
}
