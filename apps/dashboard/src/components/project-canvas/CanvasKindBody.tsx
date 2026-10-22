import { useEffect, useState } from 'react'
import { marked } from 'marked'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { Callout } from '../ui/callout'
import type { ProjectCanvas } from '../../lib/project-canvas-api'
import { canvasKindOf } from '../../lib/project-canvas/types'
import { cn } from '../../lib/utils'

function asObject(source: string): Record<string, unknown> {
  try {
    const data = JSON.parse(source || '{}')
    return data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function DocumentBody({ source }: { source: string }) {
  const html = marked.parse(source || '', { async: false })
  const safe = typeof html === 'string' ? html.replace(/<script[\s\S]*?<\/script>/gi, '') : ''
  return (
    <div
      className="prose-sm max-w-none text-sm leading-relaxed text-text-primary"
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  )
}

function DiagramBody({ source, title }: { source: string; title: string }) {
  const [svg, setSvg] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    let cancel = false
    const id = `canvas-diagram-${Math.random().toString(36).slice(2)}`
    ;(async () => {
      try {
        const mermaid = (await import('mermaid')).default
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', htmlLabels: false })
        const rendered = await mermaid.render(id, source)
        if (!cancel) {
          setSvg(rendered.svg)
          setError('')
        }
      } catch (err) {
        if (!cancel) setError(err instanceof Error ? err.message : 'Diagram')
      }
    })()
    return () => {
      cancel = true
    }
  }, [source])
  if (error) return <Callout tone="error">{error}</Callout>
  if (!svg) return <div className="skeleton-shimmer h-40 rounded-lg" aria-label={title} />
  return <div className="overflow-auto" dangerouslySetInnerHTML={{ __html: svg }} />
}

function DrawingBody({ source }: { source: string }) {
  return <div className="overflow-auto [&_svg]:h-auto [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: source }} />
}

function ImageBody({ source }: { source: string }) {
  const data = asObject(source)
  const url = typeof data.url === 'string' ? data.url : ''
  const alt = typeof data.alt === 'string' ? data.alt : ''
  if (!url) return null
  return (
    <div className="relative w-full overflow-hidden rounded-lg border border-border/60 bg-bg-elevated">
      <img src={url} alt={alt} className="max-h-[32rem] w-full object-contain" />
    </div>
  )
}

function CodeBody({ source, language }: { source: string; language?: string | null }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border/60">
      <div className="border-b border-border/60 px-3 py-1.5">
        <span className="font-mono text-2xs text-text-muted">{language || 'text'}</span>
      </div>
      <pre className="overflow-auto bg-bg-input/40 p-3 font-mono text-xs text-text-primary">
        <code>{source}</code>
      </pre>
    </div>
  )
}

function EmailBody({ canvas }: { canvas: ProjectCanvas }) {
  const data = asObject(canvas.source)
  const subject = typeof data.subject === 'string' ? data.subject : ''
  const preheader = typeof data.preheader === 'string' ? data.preheader : ''
  const body = typeof data.body_html === 'string' ? data.body_html : ''
  return (
    <Card className="mx-auto max-w-xl">
      <div className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm text-text-primary">{subject}</p>
          {preheader ? <p className="truncate text-xs text-text-muted">{preheader}</p> : null}
        </div>
      </div>
      <div className="px-4 py-4 text-sm leading-relaxed text-text-primary" dangerouslySetInnerHTML={{ __html: body }} />
    </Card>
  )
}

type SheetTab = { name: string; columns: string[]; rows: string[][] }

function sheetTabs(source: string): SheetTab[] {
  const data = asObject(source)
  const incoming = Array.isArray(data.tabs) ? data.tabs : []
  return incoming.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const tab = item as Record<string, unknown>
    const columns = Array.isArray(tab.columns) ? tab.columns.map((cell) => String(cell ?? '')) : []
    const rows = Array.isArray(tab.rows)
      ? tab.rows.flatMap((row) => (Array.isArray(row) ? [row.map((cell) => String(cell ?? ''))] : []))
      : []
    return [{ name: typeof tab.name === 'string' && tab.name ? tab.name : 'Sheet', columns, rows }]
  })
}

function SheetBody({ canvas }: { canvas: ProjectCanvas }) {
  const tabs = sheetTabs(canvas.source)
  const [index, setIndex] = useState(0)
  const tab = tabs[index] ?? tabs[0]

  if (!tab) return null
  return (
    <div className="space-y-3">
      {tabs.length > 1 ? (
        <div className="flex flex-wrap gap-1">
          {tabs.map((item, itemIndex) => (
            <Button
              key={`${item.name}-${itemIndex}`}
              type="button"
              size="sm"
              variant={itemIndex === index ? 'secondary' : 'ghost'}
              className="h-7 px-2 text-xs"
              onClick={() => setIndex(itemIndex)}
            >
              {item.name}
            </Button>
          ))}
        </div>
      ) : null}
      <div className="overflow-auto rounded-lg border border-border/60">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr>
              {tab.columns.map((column, columnIndex) => (
                <th
                  key={`${column}-${columnIndex}`}
                  className="border-b border-border/60 bg-bg-input/40 px-2 py-1.5 font-medium text-text-muted"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tab.rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-b border-border/40 last:border-0">
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="px-2 py-1.5 text-text-primary">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function CanvasKindBody({ canvas }: { canvas: ProjectCanvas }) {
  const kind = canvasKindOf(canvas.kind)
  return (
    <div className={cn('min-h-[12rem]')}>
      {kind === 'document' ? <DocumentBody source={canvas.source} /> : null}
      {kind === 'diagram' ? <DiagramBody source={canvas.source} title={canvas.title} /> : null}
      {kind === 'drawing' ? <DrawingBody source={canvas.source} /> : null}
      {kind === 'image' ? <ImageBody source={canvas.source} /> : null}
      {kind === 'code' ? <CodeBody source={canvas.source} language={canvas.language} /> : null}
      {kind === 'email' ? <EmailBody canvas={canvas} /> : null}
      {kind === 'sheet' ? <SheetBody canvas={canvas} /> : null}
    </div>
  )
}
