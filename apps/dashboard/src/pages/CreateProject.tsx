import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/button'
import { Textarea } from '../components/ui/textarea'
import { Input } from '../components/ui/input'
import { createProject } from '../lib/projects-api'

const PLACEHOLDER =
  'Example: A Dutch online shop that sells handmade ceramics and wants to grow through Instagram and a simple webshop.'

export default function CreateProject() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [scope, setScope] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const scopeOk = scope.replace(/\s/g, '').length >= 30

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!scopeOk || !name.trim() || !slug.trim()) return
    setLoading(true)
    setError(null)
    try {
      const project = await createProject({
        name: name.trim(),
        slug: slug.trim().toLowerCase().replace(/\s+/g, '-'),
        autonomous_scope: scope.trim(),
      })
      navigate(`/project/${project.id}/pkb`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create project')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold text-text-primary">Create a project</h1>
        <p className="mt-1 text-sm text-text-muted">Step 1 of 2 — describe what this project is about.</p>
      </div>
      <form className="space-y-4" onSubmit={onSubmit}>
        <div>
          <label className="text-sm font-medium text-text-primary">What is this project about?</label>
          <p className="text-xs text-text-muted">
            Describe it in a few sentences in your own words. Your AI team uses this as their north star.
          </p>
          <Textarea
            className="mt-2 min-h-[120px]"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            placeholder={PLACEHOLDER}
            maxLength={500}
            required
          />
        </div>
        <div>
          <label className="text-sm font-medium text-text-primary">Project name</label>
          <Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <label className="text-sm font-medium text-text-primary">URL slug</label>
          <Input className="mt-1" value={slug} onChange={(e) => setSlug(e.target.value)} required />
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <Button type="submit" disabled={loading || !scopeOk}>
          {loading ? 'Creating…' : 'Continue'}
        </Button>
      </form>
    </div>
  )
}
