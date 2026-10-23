import { useEffect, useMemo, useRef, useState } from 'react'
import { Pressable } from '../ui/pressable'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'
import { OrgMakeScene } from './OrgMakeScene'
import { ORG_FLOAT_PANEL } from './org-float-panel'
import { cn } from '../../lib/utils'
import { ORG_KIND_ORDER, OrgNodeFace } from './OrgNodeFace'
import { OrgCanvasSkeleton, OrgLegendSkeleton } from '../ui/skeleton'
import { ApiErrorBanner, formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { Input } from '../ui/input'
import { useAuth } from '../../context/AuthContext'
import { getOrgGraph, type OrgGraph, type OrgGraphNode } from '../../lib/teams-api'
import { EmptyState } from '../ui/empty-state'

/** The relation map from `org/graph` (membership, owners, labels), always in 3D. */
export function OrgStructureMap() {
  const { t } = useTranslation('nav')
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { token } = useAuth()
  const [graph, setGraph] = useState<OrgGraph | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null)
  const highlightRef = useRef<(id: string | null) => void>(() => {})
  const focusParam = searchParams.get('focus')?.trim() || null

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

  useEffect(() => {
    if (!graph || !focusParam) return
    if (!linkedIds.has(focusParam)) return
    setFocusNodeId(focusParam)
  }, [graph, focusParam, linkedIds])

  const clearFocusParam = () => {
    setFocusNodeId(null)
    if (!searchParams.has('focus')) return
    const next = new URLSearchParams(searchParams)
    next.delete('focus')
    setSearchParams(next, { replace: true })
  }

  const kindLabel = (kind: string) => t(`orgCanvas.kinds.${kind}`, { defaultValue: kind })

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
    return ORG_KIND_ORDER.filter((kind) => byKind.has(kind)).map((kind) => ({ kind, nodes: byKind.get(kind) ?? [] }))
  }, [graph, linkedIds, query, t])

  return (
    <div className="absolute inset-0">
      <div className="absolute inset-0 flex flex-col">
        {error ? (
          <div className="absolute inset-x-4 top-16 z-20">
            <ApiErrorBanner message={error} />
          </div>
        ) : null}
        {graph ? (
          <OrgMakeScene
            graph={graph}
            linkedIds={linkedIds}
            focusNodeId={focusNodeId}
            onFocused={clearFocusParam}
            highlightRef={highlightRef}
            kindLabel={kindLabel}
            openHint={t('orgCanvas.openHint')}
            onOpenNode={(node) => {
              if (node.href) navigate(node.href)
            }}
          />
        ) : (
          <OrgCanvasSkeleton />
        )}
      </div>
      <aside className={cn(ORG_FLOAT_PANEL, 'top-3 max-h-[calc(100%-2.25rem)]')}>
        <div className="shrink-0 px-3 py-2.5">
          <h2 className="text-sm font-semibold tracking-tight text-text-heading">{t('orgCanvas.legend')}</h2>
          <p className="mt-0.5 text-2xs leading-4 text-text-muted">{t('orgCanvas.legendHint')}</p>
          <label className="relative mt-2 block">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('orgCanvas.findPlaceholder')}
              className="h-8 w-full pl-7 text-xs"
            />
          </label>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
          {!graph && !error ? (
            <OrgLegendSkeleton />
          ) : legendGroups.length === 0 ? (
            <EmptyState tone="plain" size="sm" className="px-1.5 py-3" title={t('orgCanvas.findEmpty')} />
          ) : (
            legendGroups.map((group) => (
              <div key={group.kind} className="mb-2">
                <p className="px-1.5 pb-0.5 pt-1 text-2xs font-semibold uppercase tracking-wide text-text-muted">
                  {kindLabel(group.kind)}
                  <span className="ml-1 font-normal tabular-nums">({group.nodes.length})</span>
                </p>
                <ul>
                  {group.nodes.map((node) => (
                    <li key={node.id}>
                      <Pressable
                        type="button"
                        title={t('orgCanvas.findAction', { name: node.label })}
                        onMouseEnter={() => highlightRef.current(node.id)}
                        onMouseLeave={() => highlightRef.current(null)}
                        onClick={() => setFocusNodeId(node.id)}
                        className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs text-text-secondary hover:bg-bg-elevated hover:text-text-heading"
                      >
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                          <OrgNodeFace node={node} size={16} />
                        </span>
                        <span className="truncate">{node.label}</span>
                      </Pressable>
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
