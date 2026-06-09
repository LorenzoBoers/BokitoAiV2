import { useState } from 'react'
import { X, Save } from 'lucide-react'
import { useDatabase } from '../../context/DatabaseContext'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import type { CustomTable } from '../../types/custom-db'

interface TableDescriptionDialogProps {
  table: CustomTable
  onClose: () => void
}

export default function TableDescriptionDialog({ table, onClose }: TableDescriptionDialogProps) {
  const { updateTable } = useDatabase()
  const [description, setDescription] = useState(table.description || '')
  const [saving, setSaving] = useState(false)

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await updateTable(table.id, { description: description.trim() })
      onClose()
    } catch (error) {
      console.error('Failed to update table description:', error)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[1px] flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Tabel beschrijving</CardTitle>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
          >
            <X size={14} />
          </button>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="text-xs font-medium text-text-secondary mb-1 block">
                Tabel: {table.name}
              </label>
              <p className="text-xs text-text-muted mb-3">
                Voeg een beschrijving toe om anderen te helpen begrijpen waarvoor deze tabel wordt gebruikt.
              </p>
            </div>

            <div>
              <label className="text-xs font-medium text-text-secondary mb-1 block">
                Beschrijving
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Beschrijf het doel en gebruik van deze tabel..."
                className="w-full h-24 px-3 py-2 text-sm border border-border rounded-md bg-bg-primary text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/50"
                maxLength={500}
                autoFocus
              />
              <div className="text-xs text-text-muted mt-1 text-right">
                {description.length}/500
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
                Annuleren
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? (
                  <>
                    <Save size={12} className="mr-1" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save size={12} className="mr-1" />
                    Save
                  </>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}