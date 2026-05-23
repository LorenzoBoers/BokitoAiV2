import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Button } from '../components/ui/button'
import { listPkbSections, type PkbSectionRow } from '../lib/pkb-api'
import { getProject, type ProjectRow } from '../lib/projects-api'

function stripCodeBlocks(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '')
    .trim()
}

function SectionList({ rows }: { rows: PkbSectionRow[] }) {
  if (!rows.length) {
    return <p className="text-sm text-text-muted">Nothing here yet. Your team will fill this in shortly.</p>
  }
  return (
    <ul className="space-y-4">
      {rows.map((row) => (
        <li key={row.id} className="rounded-lg border border-border-subtle bg-surface-raised p-4">
          {row.title ? <h3 className="font-medium text-text-primary">{row.title}</h3> : null}
          {row.domain ? (
            <span className="mt-1 inline-block rounded-full bg-surface-muted px-2 py-0.5 text-xs text-text-muted">
              {row.domain}
            </span>
          ) : null}
          <p className="mt-2 whitespace-pre-wrap text-base leading-relaxed text-text-primary">
            {stripCodeBlocks(row.content)}
          </p>
        </li>
      ))}
    </ul>
  )
}

export default function Pkb() {
  const { projectId } = useParams<{ projectId: string }>()
  const [project, setProject] = useState<ProjectRow | null>(null)
  const [sections, setSections] = useState<PkbSectionRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!projectId) return
    setLoading(true)
    Promise.all([
      getProject(projectId).catch(() => null),
      listPkbSections(projectId).catch(() => [] as PkbSectionRow[]),
    ])
      .then(([proj, rows]) => {
        setProject(proj)
        setSections(rows)
      })
      .finally(() => setLoading(false))
  }, [projectId])

  const domains = useMemo(() => {
    const set = new Set<string>()
    sections.forEach((s) => {
      if (s.domain) set.add(s.domain)
    })
    return [...set]
  }, [sections])

  const [domainFilter, setDomainFilter] = useState<string | null>(null)

  const filtered = useMemo(() => {
    if (!domainFilter) return sections
    return sections.filter((s) => s.domain === domainFilter)
  }, [sections, domainFilter])

  const current = filtered.filter((s) => s.layer === 'current_state')
  const intended = filtered.filter((s) => s.layer === 'intended_state')
  const changes = filtered.filter((s) => s.layer === 'change_queue')

  if (!projectId) return <p className="p-6 text-sm text-text-muted">Select a project.</p>

  return (
    <div className="space-y-4 p-6">
      {project ? (
        <header className="rounded-lg border border-border-subtle bg-surface-raised p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-2">
              <p className="text-xs uppercase tracking-wide text-text-muted">Project</p>
              <h1 className="text-2xl font-semibold text-text-primary">{project.name}</h1>
              {project.autonomous_scope ? (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-primary">
                  <span className="font-medium text-text-muted">About this project: </span>
                  {project.autonomous_scope}
                </p>
              ) : null}
            </div>
            <Button asChild size="sm" variant="secondary">
              <Link to={`/project/${projectId}/request`}>Request a change</Link>
            </Button>
          </div>
        </header>
      ) : (
        <h1 className="text-xl font-semibold text-text-primary">Project knowledge</h1>
      )}
      {domains.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={`rounded-full px-3 py-1 text-xs ${!domainFilter ? 'bg-brand-primary text-white' : 'bg-surface-muted text-text-muted'}`}
            onClick={() => setDomainFilter(null)}
          >
            All
          </button>
          {domains.map((d) => (
            <button
              key={d}
              type="button"
              className={`rounded-full px-3 py-1 text-xs ${domainFilter === d ? 'bg-brand-primary text-white' : 'bg-surface-muted text-text-muted'}`}
              onClick={() => setDomainFilter(d)}
            >
              {d}
            </button>
          ))}
        </div>
      ) : null}
      {loading ? (
        <p className="text-sm text-text-muted">Loading…</p>
      ) : (
        <Tabs defaultValue="today">
          <TabsList>
            <TabsTrigger value="today">What this project is today</TabsTrigger>
            <TabsTrigger value="going">Where it is going</TabsTrigger>
            <TabsTrigger value="changing">What is changing</TabsTrigger>
          </TabsList>
          <TabsContent value="today">
            <SectionList rows={current} />
          </TabsContent>
          <TabsContent value="going">
            <SectionList rows={intended} />
          </TabsContent>
          <TabsContent value="changing">
            <SectionList rows={changes} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
