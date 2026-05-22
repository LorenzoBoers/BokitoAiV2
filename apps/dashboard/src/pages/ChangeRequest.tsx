import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '../components/ui/button'
import { Textarea } from '../components/ui/textarea'
import { submitChangeRequest } from '../lib/pkb-api'

export default function ChangeRequest() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const [content, setContent] = useState('')
  const [priority, setPriority] = useState<'low' | 'normal' | 'urgent'>('normal')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const priorityMap = { low: 7, normal: 5, urgent: 2 }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!projectId || !content.trim()) return
    setLoading(true)
    setError(null)
    try {
      const row = await submitChangeRequest({
        project_id: projectId,
        content: content.trim(),
        priority: priorityMap[priority],
      })
      navigate(`/project/${projectId}/pkb`, { state: { highlightSectionId: row.id } })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit request')
    } finally {
      setLoading(false)
    }
  }

  if (!projectId) return <p className="p-6 text-sm text-text-muted">Select a project.</p>

  return (
    <div className="mx-auto max-w-lg space-y-4 p-6">
      <h1 className="text-xl font-semibold text-text-primary">Request a change</h1>
      <p className="text-sm text-text-muted">
        Describe what you want to change or add in your own words. Your team will pick it up from here.
      </p>
      <form className="space-y-4" onSubmit={onSubmit}>
        <Textarea
          className="min-h-[160px]"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="What would you like to change or add?"
          required
        />
        <div className="flex gap-2">
          {(['low', 'normal', 'urgent'] as const).map((p) => (
            <button
              key={p}
              type="button"
              className={`rounded-md px-3 py-1 text-sm ${priority === p ? 'bg-brand-primary text-white' : 'bg-surface-muted text-text-muted'}`}
              onClick={() => setPriority(p)}
            >
              {p === 'low' ? 'Whenever you can' : p === 'urgent' ? 'Urgent' : 'Soon'}
            </button>
          ))}
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <Button type="submit" disabled={loading || !content.trim()}>
          {loading ? 'Submitting…' : 'Submit request'}
        </Button>
      </form>
    </div>
  )
}
