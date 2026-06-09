import { useState } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal, Pencil, Trash2, Settings } from 'lucide-react'
import { useDatabase } from '../../context/DatabaseContext'
import type { CustomTable } from '../../types/custom-db'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import ConfirmDeleteDialog from '../ui/ConfirmDeleteDialog'
import TableSettingsDialog from './TableSettingsDialog'

export default function TableSettingsDropdown({ table }: { table: CustomTable }) {
  const { updateTable, removeTable } = useDatabase()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [newName, setNewName] = useState(table.name)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const canUsePortal = typeof document !== 'undefined'

  const handleRename = async () => {
    if (!newName.trim() || newName.trim() === table.name) { setEditing(false); return }
    try {
      await updateTable(table.id, { name: newName.trim() })
    } catch { /* ignore */ }
    setEditing(false)
    setOpen(false)
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await removeTable(table.id)
    } catch { /* ignore */ }
    setDeleting(false)
    setOpen(false)
    setConfirmDelete(false)
  }

  if (editing) {
    const modal = (
      <div className="fixed inset-0 z-[80] bg-black/45 backdrop-blur-[1px] flex items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardHeader><CardTitle>Tabel hernoemen</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={(e) => { e.preventDefault(); void handleRename() }} className="space-y-3">
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Annuleren</Button>
                <Button type="submit">Save</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    )
    return canUsePortal ? createPortal(modal, document.body) : modal
  }

  if (confirmDelete) {
    const dialog = (
      <ConfirmDeleteDialog
        title="Tabel verwijderen?"
        itemLabel="de tabel"
        itemName={table.name}
        impactText="Deze actie verwijdert ook alle bijbehorende velden, records en views permanent."
        isDeleting={deleting}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
      />
    )
    return canUsePortal ? createPortal(dialog, document.body) : dialog
  }

  if (showSettings) {
    const dialog = <TableSettingsDialog table={table} onClose={() => setShowSettings(false)} />
    return canUsePortal ? createPortal(dialog, document.body) : dialog
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
        className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
      >
        <MoreHorizontal size={14} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 min-w-[160px] rounded-md border border-border bg-bg-elevated shadow-lg py-1">
            <button
              type="button"
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary"
              onClick={() => { setOpen(false); setShowSettings(true) }}
            >
              <Settings size={12} /> Instellingen
            </button>
            <button
              type="button"
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary"
              onClick={() => { setOpen(false); setEditing(true) }}
            >
              <Pencil size={12} /> Hernoemen
            </button>
            {table.is_standard ? (
              <div className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-muted cursor-not-allowed">
                <Lock size={12} /> Beveiligd
              </div>
            ) : (
              <button
                type="button"
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-status-error hover:bg-status-error/10"
                onClick={() => { setOpen(false); setConfirmDelete(true) }}
              >
                <Trash2 size={12} /> Delete
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
