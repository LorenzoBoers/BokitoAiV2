import { useCallback, useEffect, useMemo, useState } from 'react'
import { BookOpen, FileText, Link2, Loader2, Plus, RefreshCw } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { type DocItem, type DocPageItem, type DocSectionItem } from '../data/projects-data'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { xanoGet } from '../lib/xano'

interface DocsApiResponse {
  docs: DocItem[]
  pages: DocPageItem[]
  sections: DocSectionItem[]
}

function toDoc(raw: Record<string, unknown>, index: number, tenantSlug: string): DocItem {
  return {
    id: String(raw.id ?? `doc-${index}`),
    tenantSlug:
      typeof raw.tenantSlug === 'string'
        ? raw.tenantSlug
        : typeof raw.tenant_slug === 'string'
          ? raw.tenant_slug
          : tenantSlug,
    name: String(raw.name ?? raw.title ?? `Documentatie ${index + 1}`),
    url: String(raw.url ?? raw.source_url ?? ''),
    lastSyncedAt: String(raw.lastSyncedAt ?? raw.last_synced_at ?? raw.updated_at ?? new Date().toISOString()),
    activeForAgents: Boolean(raw.activeForAgents ?? raw.active_for_agents ?? true),
  }
}

function toDocPage(raw: Record<string, unknown>, index: number): DocPageItem {
  return {
    id: String(raw.id ?? `page-${index}`),
    docId: String(raw.docId ?? raw.doc_id ?? ''),
    url: String(raw.url ?? ''),
    title: String(raw.title ?? 'Pagina'),
  }
}

function toDocSection(raw: Record<string, unknown>, index: number): DocSectionItem {
  return {
    id: String(raw.id ?? `section-${index}`),
    pageId: String(raw.pageId ?? raw.page_id ?? ''),
    heading: String(raw.heading ?? 'Sectie'),
    excerpt: String(raw.excerpt ?? raw.content ?? ''),
  }
}

function normalizeDocsResponse(payload: unknown, authTenantSlug: string): DocsApiResponse {
  if (Array.isArray(payload)) {
    const docs = payload
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      .map((item, index) => toDoc(item, index, authTenantSlug))
    return {
      docs,
      pages: [],
      sections: [],
    }
  }

  if (!payload || typeof payload !== 'object') {
    return { docs: [], pages: [], sections: [] }
  }

  const objectPayload = payload as Record<string, unknown>
  const rawDocs = Array.isArray(objectPayload.docs) ? objectPayload.docs : []
  const docs = rawDocs
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item, index) => toDoc(item, index, authTenantSlug))

  const rawPages = Array.isArray(objectPayload.pages) ? objectPayload.pages : []
  const pages = rawPages
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item, index) => toDocPage(item, index))

  const rawSections = Array.isArray(objectPayload.sections) ? objectPayload.sections : []
  const sections = rawSections
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item, index) => toDocSection(item, index))

  return {
    docs,
    pages,
    sections,
  }
}

function formatSyncDate(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return 'Onbekend'
  return parsed.toLocaleString('nl-NL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function Projects() {
  const { token, user } = useAuth()
  const [docs, setDocs] = useState<DocItem[]>([])
  const [pages, setPages] = useState<DocPageItem[]>([])
  const [sections, setSections] = useState<DocSectionItem[]>([])
  const [urlInput, setUrlInput] = useState('')
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const authTenantSlug = user?.tenant?.slug && user.tenant.slug !== 'unknown' ? user.tenant.slug : 'unknown-workspace'

  const fetchDocs = useCallback(async () => {
    if (!token) return
    setIsLoading(true)
    setError(null)
    try {
      const payload = await xanoGet<unknown>('/docs', token)
      const normalized = normalizeDocsResponse(payload, authTenantSlug)
      setDocs(normalized.docs)
      setPages(normalized.pages)
      setSections(normalized.sections)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Kon docs niet ophalen.'
      setError(message)
      setDocs([])
      setPages([])
      setSections([])
    } finally {
      setIsLoading(false)
    }
  }, [authTenantSlug, token])

  useEffect(() => {
    void fetchDocs()
  }, [fetchDocs])

  const tenantDisplayName = useMemo(() => {
    const n = user?.tenant?.name?.trim()
    if (n && n !== 'Onbekend') return n
    const s = user?.tenant?.slug?.trim()
    if (s && s !== 'unknown') return s
    return 'je organisatie'
  }, [user?.tenant?.name, user?.tenant?.slug])

  const DEFAULT_TENANT_LOGO = '/bokito-logo.svg'
  const remoteTenantLogo = user?.tenant?.logo?.trim() ?? ''
  const [tenantLogoBroken, setTenantLogoBroken] = useState(false)

  useEffect(() => {
    setTenantLogoBroken(false)
  }, [remoteTenantLogo, user?.id])

  const headerLogoSrc =
    !remoteTenantLogo || tenantLogoBroken ? DEFAULT_TENANT_LOGO : remoteTenantLogo
  const visibleDocs = docs
  const visiblePages = pages
  const visibleSections = sections

  const docStats = useMemo(() => {
    const pageCounts = new Map<string, number>()
    const sectionCounts = new Map<string, number>()
    const pageToDoc = new Map<string, string>()

    for (const page of visiblePages) {
      pageToDoc.set(page.id, page.docId)
      pageCounts.set(page.docId, (pageCounts.get(page.docId) ?? 0) + 1)
    }

    for (const section of visibleSections) {
      const docId = pageToDoc.get(section.pageId)
      if (!docId) continue
      sectionCounts.set(docId, (sectionCounts.get(docId) ?? 0) + 1)
    }

    return { pageCounts, sectionCounts }
  }, [visiblePages, visibleSections])

  const handleAddDoc = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedUrl = urlInput.trim()
    if (!trimmedUrl) return

    let inferredName = trimmedUrl
    try {
      inferredName = new URL(trimmedUrl).hostname.replace(/^www\./, '')
    } catch {
      // Keep input as fallback name when URL parsing fails.
    }

    const draftDoc: DocItem = {
      id: `draft-${Date.now()}`,
      tenantSlug: authTenantSlug,
      name: inferredName,
      url: trimmedUrl,
      lastSyncedAt: new Date().toISOString(),
      activeForAgents: true,
    }

    setDocs((previous) => [draftDoc, ...previous])
    setUrlInput('')
    setIsAddModalOpen(false)
  }

  return (
    <div className="h-full py-4 flex flex-col gap-3 overflow-y-auto">
      <Card>
        <CardHeader>
          <div className="flex items-start gap-3 min-w-0 flex-1 pr-2">
            <img
              src={headerLogoSrc}
              alt=""
              className="w-10 h-10 flex-shrink-0 object-contain rounded-md border border-border/60 bg-bg-elevated/80"
              onError={() => {
                if (remoteTenantLogo) setTenantLogoBroken(true)
              }}
            />
            <div className="min-w-0">
              <CardTitle>AI Bronnen van {tenantDisplayName}</CardTitle>
              <p className="text-xs text-text-secondary mt-0.5">
                Voeg bronnen toe via de knop. AI zal later de pagina plus subpagina&apos;s scrapen.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => void fetchDocs()} disabled={isLoading || !token}>
              {isLoading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              Vernieuwen
            </Button>
            <Button size="sm" onClick={() => setIsAddModalOpen(true)}>
              <Plus size={13} />
              URL toevoegen
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="panel h-[140px] flex items-center justify-center text-text-secondary text-sm gap-2">
              <Loader2 size={14} className="animate-spin" />
              Docs laden...
            </div>
          ) : visibleDocs.length === 0 ? (
            <div className="panel h-[140px] flex items-center justify-center text-sm text-text-secondary">
              Geen docs gevonden voor {tenantDisplayName}
            </div>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {visibleDocs.map((doc) => {
                const pageCount = docStats.pageCounts.get(doc.id) ?? 0
                const sectionCount = docStats.sectionCounts.get(doc.id) ?? 0
                return (
                  <Card key={doc.id} className="min-w-[280px] max-w-[320px] flex-shrink-0">
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-7 h-7 rounded-md bg-accent/12 text-accent flex items-center justify-center shrink-0">
                          <BookOpen size={14} />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-text-heading truncate">{doc.name}</div>
                          <div className="text-xs text-text-muted truncate">{doc.url}</div>
                        </div>
                      </div>

                      <div className="text-xs text-text-secondary">
                        Laatst gesynchroniseerd: {formatSyncDate(doc.lastSyncedAt)}
                      </div>

                      <div className="flex items-center gap-3 text-xs text-text-muted">
                        <span className="inline-flex items-center gap-1">
                          <FileText size={12} />
                          {pageCount} pagina&apos;s
                        </span>
                        <span>{sectionCount} secties</span>
                      </div>

                      <Badge variant="success" className="mt-1">Geïndexeerd</Badge>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}

          {error && <p className="mt-2 text-xs text-text-muted">Kon docs niet verversen: {error}</p>}
          <p className="text-xs text-text-muted mt-2">URL ingest is nu UI-only. De scraper-flow volgt later.</p>
        </CardContent>
      </Card>

      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[1px] flex items-center justify-center p-4">
          <Card className="w-full max-w-lg">
            <CardHeader>
              <div>
                <CardTitle>Nieuwe docs bron</CardTitle>
                <p className="text-xs text-text-secondary mt-0.5">
                  Voeg een URL toe. Scrapen van hoofd- en subpagina&apos;s wordt later gekoppeld.
                </p>
              </div>
            </CardHeader>
            <CardContent>
              <form className="space-y-3" onSubmit={handleAddDoc}>
                <div className="relative">
                  <Link2 size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
                  <Input
                    value={urlInput}
                    onChange={(event) => setUrlInput(event.target.value)}
                    className="pl-8"
                    placeholder="https://docs.jouwdomein.nl"
                    autoFocus
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="ghost" onClick={() => setIsAddModalOpen(false)}>
                    Annuleren
                  </Button>
                  <Button type="submit">
                    <Plus size={13} />
                    Toevoegen
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
