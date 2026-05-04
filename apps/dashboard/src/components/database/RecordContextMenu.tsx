import { useEffect, useRef, useState } from 'react'
import { Copy, Trash2, ExternalLink, RotateCcw } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import type { CustomRecord, CustomField } from '../../types/custom-db'
import * as api from '../../lib/custom-db-api'

interface RecordContextMenuProps {
  record: CustomRecord
  fields: CustomField[]
  position: { x: number; y: number }
  onClose: () => void
  onDelete: (recordId: number) => void
  onRestore?: (recordId: number) => void
}

export default function RecordContextMenu({
  record,
  fields,
  position,
  onClose,
  onDelete,
  onRestore,
}: RecordContextMenuProps) {
  const navigate = useNavigate()
  const { tableSlug } = useParams<{ tableSlug?: string }>()
  const menuRef = useRef<HTMLDivElement>(null)
  const [duplicating, setDuplicating] = useState(false)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose()
      }
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  const handleDuplicate = async () => {
    if (duplicating) return

    setDuplicating(true)
    try {
      // Show dialog for relation fields selection
      const relationFields = fields.filter(f => f.field_type === 'relation')
      
      if (relationFields.length > 0) {
        const includeRelations = await showDuplicateDialog(relationFields)
        const duplicated = await api.duplicateRecord(record.id, { includeRelations })
        
        if (tableSlug) {
          navigate(`/database/${tableSlug}/record/${duplicated.id}`)
        }
      } else {
        const duplicated = await api.duplicateRecord(record.id)
        
        if (tableSlug) {
          navigate(`/database/${tableSlug}/record/${duplicated.id}`)
        }
      }
      
      onClose()
    } catch (error) {
      console.error('Failed to duplicate record:', error)
    } finally {
      setDuplicating(false)
    }
  }

  const handleOpenRecord = () => {
    if (tableSlug) {
      navigate(`/database/${tableSlug}/record/${record.id}`)
    }
    onClose()
  }

  const handleDelete = () => {
    onDelete(record.id)
    onClose()
  }

  const handleRestore = () => {
    if (onRestore) {
      onRestore(record.id)
    }
    onClose()
  }

  return (
    <div
      ref={menuRef}
      className="fixed z-[100] bg-bg-primary border border-border rounded-lg shadow-lg py-1 min-w-[160px]"
      style={{
        left: position.x,
        top: position.y,
      }}
    >
      <button
        type="button"
        onClick={handleOpenRecord}
        className="w-full px-3 py-2 text-left text-sm hover:bg-bg-hover transition-colors flex items-center gap-2"
      >
        <ExternalLink size={14} />
        Record openen
      </button>
      
      <button
        type="button"
        onClick={handleDuplicate}
        disabled={duplicating}
        className="w-full px-3 py-2 text-left text-sm hover:bg-bg-hover transition-colors flex items-center gap-2 disabled:opacity-50"
      >
        <Copy size={14} />
        {duplicating ? 'Dupliceren...' : 'Dupliceer record'}
      </button>

      <div className="border-t border-border my-1" />

      {record.is_deleted && onRestore ? (
        <button
          type="button"
          onClick={handleRestore}
          className="w-full px-3 py-2 text-left text-sm hover:bg-bg-hover transition-colors flex items-center gap-2 text-status-success"
        >
          <RotateCcw size={14} />
          Herstellen
        </button>
      ) : (
        <button
          type="button"
          onClick={handleDelete}
          className="w-full px-3 py-2 text-left text-sm hover:bg-bg-hover transition-colors flex items-center gap-2 text-status-error"
        >
          <Trash2 size={14} />
          {record.is_deleted ? 'Permanent verwijderen' : 'Verwijderen'}
        </button>
      )}
    </div>
  )
}

function showDuplicateDialog(relationFields: CustomField[]): Promise<string[]> {
  return new Promise((resolve) => {
    // For now, include all relations by default
    // In a real implementation, you'd show a dialog with checkboxes
    const includeAll = relationFields.map(f => f.slug)
    resolve(includeAll)
  })
}