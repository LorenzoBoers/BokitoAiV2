import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'
import { OrgMakeScene } from '../components/org/OrgMakeScene'
import { ORG_KIND_ORDER, OrgNodeFace } from '../components/org/OrgNodeFace'
import { ApiErrorBanner, formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import { useAuth } from '../context/AuthContext'
import { getOrgGraph, type OrgGraph, type OrgGraphNode } from '../lib/teams-api'

/** Full-bleed Make Grid–style organization map (Three.js). */
export default function OrgCanvasPage() {
  const { t } = useTranslation('nav')
  const navigate = useNavigate()
  const { token } = useAuth()
  const [graph, setGraph] = useState<OrgGraph | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    getOrgGraph(token)
      .then(setGraph)
      .catch((err) => setError(formatApiErrorMessage(err, t('orgCanvas.loadError'))))
  }, [token, t])

  const linkedIds = useMemo(() => {
    const ids = new Set<string>()
    for (const edge of graph?.edges ?? []) {
      ids.add(edge.source)
      ids.add(edge.target)
    }
    return ids
  }, [graph])

  const kindLabel = (kind: string) =>
    t(`orgCanvas.kinds.${kind}`, { defaultValue: kind })

  const legendGroups = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const onMap = (graph?.nodes ?? []).filter((node) => linkedIds.has(node.id))
    const filtered = needle
      ? onMap.filter((node) => {
          const kindName = t(`orgCanvas.kinds.${node.kind}`, { defaultValue: node.kind })
          return (
            node.label.toLowerCase().includes(needle) ||
            node.kind.toLowerCase().includes(needle) ||
            kindName.toLowerCase().includes(needle)
          )
        })
      : onMap
    const byKind = new Map<string, OrgGraphNode[]>()
    for (const node of filtered) {
      const list = byKind.get(node.kind) ?? []
      list.push(node)
      byKind.set(node.kind, list)
    }
    for (const list of byKind.values()) {
      list.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
    }
    return ORG_KIND_ORDER.filter((kind) => byKind.has(kind)).map((kind) => ({
      kind,
      nodes: byKind.get(kind) ?? [],
    }))
  }, [graph, linkedIds, query, t])

  return (
    <div className="relative flex h-full min-h-0 w-full overflow-hidden bg-bg">
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start px-4 pt-3">
          <div className="pointer-events-auto max-w-xl rounded-xl border border-border/40 bg-bg-surface/80 px-3 py-2 shadow-sm backdrop-blur-sm">
            <h1 className="text-sm font-semibold tracking-tight text-text-heading">{t('orgCanvas.title')}</h1>
            <p className="mt-0.5 text-[11px] leading-4 text-text-muted">{t('orgCanvas.subtitle')}</p>
          </div>
        </div>
        {error ? (
          <div className="absolute inset-x-4 top-16 z-10">
            <ApiErrorBanner message={error} />
          </div>
        ) : null}
        {graph ? (
          <OrgMakeScene
            graph={graph}
            linkedIds={linkedIds}
            focusNodeId={focusNodeId}
            onFocused={() => setFocusNodeId(null)}
            kindLabel={kindLabel}
            openHint={t('orgCanvas.openHint')}
            onOpenNode={(node) => {
              if (node.href) navigate(node.href)
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-text-muted">…</div>
        )}
      </div>
      <aside className="flex h-full w-64 shrink-0 flex-col border-l border-border/40 bg-bg-surface/95">
        <div className="border-b border-border/40 px-3 py-2.5">
          <h2 className="text-sm font-semibold tracking-tight text-text-heading">{t('orgCanvas.legend')}</h2>
          <p className="mt-0.5 text-[11px] leading-4 text-text-muted">{t('orgCanvas.legendHint')}</p>
          <label className="relative mt-2 block">
            <Search
              className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted"
              strokeWidth={1.75}
            />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('orgCanvas.findPlaceholder')}
              className="h-8 w-full rounded-md border border-border/40 bg-bg px-2 pl-7 text-xs text-text-heading outline-none placeholder:text-text-muted focus:border-accent/40"
            />
          </label>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
          {legendGroups.length === 0 ? (
            <p className="px-1.5 py-2 text-[11px] text-text-muted">{t('orgCanvas.findEmpty')}</p>
          ) : (
            legendGroups.map((group) => (
              <div key={group.kind} className="mb-2">
                <p className="px-1.5 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                  {kindLabel(group.kind)}
                  <span className="ml-1 font-normal tabular-nums">({group.nodes.length})</span>
                </p>
                <ul>
                  {group.nodes.map((node) => (
                    <li key={node.id}>
                      <button
                        type="button"
                        title={t('orgCanvas.findAction', { name: node.label })}
                        onClick={() => setFocusNodeId(node.id)}
                        className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs text-text-secondary hover:bg-bg-elevated hover:text-text-heading"
                      >
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                          <OrgNodeFace node={node} size={16} />
                        </span>
                        <span className="truncate">{node.label}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      </aside>
    </div>
  )
}
