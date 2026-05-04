import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useDatabase } from '../../context/DatabaseContext'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'

const COLORS = ['#6366f1', '#f43f5e', '#10b981', '#f59e0b', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6']

export default function CreateTableDialog({ onClose }: { onClose: () => void }) {
  const { createTable, setActiveTableById } = useDatabase()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState(COLORS[0])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    setError(null)
    try {
      const tableData: { name: string; description?: string; color: string } = { 
        name: name.trim(), 
        color 
      };
      if (description.trim()) {
        tableData.description = description.trim();
      }
      const t = await createTable(tableData)
      setActiveTableById(t.id)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fout bij aanmaken')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[1px] flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Nieuwe tabel</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs font-medium text-text-secondary mb-1 block">Naam</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Bijv. Klanten, Projecten..."
                autoFocus
              />
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary mb-1 block">Beschrijving (optioneel)</label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Waar is deze tabel voor?"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary mb-1.5 block">Kleur</label>
              <div className="flex gap-2">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={`w-6 h-6 rounded-full transition-all ${color === c ? 'ring-2 ring-offset-2 ring-offset-bg-primary ring-accent scale-110' : 'hover:scale-105'}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
            {error && <p className="text-xs text-status-error">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Annuleren</Button>
              <Button type="submit" disabled={saving || !name.trim()}>
                {saving && <Loader2 size={14} className="animate-spin mr-1" />}
                Aanmaken
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
