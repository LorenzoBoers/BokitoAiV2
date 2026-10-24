import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { marked } from 'marked'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { Callout } from '../ui/callout'
import type { ProjectCanvas } from '../../lib/project-canvas-api'
import { canvasKindOf } from '../../lib/project-canvas/types'
import { cn } from '../../lib/utils'
import { DesignBoard } from './DesignBoard'
import { mermaidInitConfig, readDiagramPalette } from './mermaid-theme'

function asObject(source: string): Record<string, unknown> {
  try {
    const data = JSON.parse(source || '{}')
    return data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** Drop a leading heading that only repeats the window title. */
export function documentSource(source: string, title: string): string {
  const trimmed = (source || '').trim()
  const heading = trimmed.match(/^#\s+(.+?)\s*(?:\n|$)/)
  if (!heading) return source || ''
  const same = heading[1].trim().toLowerCase() === title.trim().toLowerCase()
  return same ? trimmed.slice(heading[0].length).trimStart() : source || ''
}

function DocumentBody({ source, title }: { source: string; title: string }) {
  const html = marked.parse(documentSource(source, title), { async: false })
  const safe = typeof html === 'string' ? html.replace(/<script[\s\S]*?<\/script>/gi, '') : ''
  return <div className="canvas-prose" dangerouslySetInnerHTML={{ __html: safe }} />
}

function useCanvasTheme(): string {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'dark')
  useEffect(() => {
    const root = document.documentElement
    const sync = () => setTheme(root.dataset.theme || 'dark')
    const observer = new MutationObserver(sync)
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])
  return theme
}

function DiagramBody({ source, title }: { source: string; title: string }) {
  const theme = useCanvasTheme()
  const [svg, setSvg] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    let cancel = false
    const id = `canvas-diagram-${Math.random().toString(36).slice(2)}`
    ;(async () => {
      try {
        const mermaid = (await import('mermaid')).default
        const palette = readDiagramPalette(document.documentElement)
        mermaid.initialize(mermaidInitConfig(palette))
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
      document.getElementById(id)?.remove()
    }
  }, [source, theme])
  if (error) return <Callout tone="error">{error}</Callout>
  if (!svg) return <div className="skeleton-shimmer h-40 rounded-lg" aria-label={title} />
  return <div className="canvas-diagram overflow-auto" dangerouslySetInnerHTML={{ __html: svg }} />
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
    <div className="relative w-full overflow-hidden rounded-lg border border-border bg-bg-elevated">
      <img src={url} alt={alt} className="max-h-[32rem] w-full object-contain" />
    </div>
  )
}

function CodeBody({ source, language }: { source: string; language?: string | null }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="border-b border-border px-3 py-1.5">
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
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm text-text-primary">{subject}</p>
          {preheader ? <p className="truncate text-xs text-text-muted">{preheader}</p> : null}
        </div>
      </div>
      <div className="canvas-prose px-4 py-4" dangerouslySetInnerHTML={{ __html: body }} />
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

function looksNumeric(value: string): boolean {
  return /^-?\d+(?:[.,]\d+)?%?$/.test(value.trim().replace(/\s/g, ''))
}

/** A column of figures lines up on the right, like a spreadsheet. */
export function numericColumns(columns: string[], rows: string[][]): boolean[] {
  return columns.map((_, columnIndex) => {
    const cells = rows.map((row) => (row[columnIndex] || '').trim()).filter(Boolean)
    if (!cells.length) return false
    const numeric = cells.filter((cell) => looksNumeric(cell)).length
    return numeric / cells.length >= 0.8
  })
}

function SheetBody({ canvas }: { canvas: ProjectCanvas }) {
  const { t } = useTranslation('nav')
  const tabs = sheetTabs(canvas.source)
  const [index, setIndex] = useState(0)
  const tab = tabs[index] ?? tabs[0]

  if (!tab) return null
  const numeric = numericColumns(tab.columns, tab.rows)
  return (
    <div className="space-y-3">
      {tabs.length > 1 ? (
        <div className="flex flex-wrap gap-1">
          {tabs.map((item, itemIndex) => (
            <Button
              key={`${item.name}-${itemIndex}`}
              type="button"
              size="xs"
              variant={itemIndex === index ? 'secondary' : 'ghost'}
              className="px-2 text-xs"
              onClick={() => setIndex(itemIndex)}
            >
              {item.name}
            </Button>
          ))}
        </div>
      ) : null}
      <div className="overflow-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr>
              {tab.columns.map((column, columnIndex) => (
                <th
                  key={`${column}-${columnIndex}`}
                  className={cn(
                    'sticky top-0 border-b border-border bg-bg-elevated px-2 py-1.5 font-medium text-text-muted',
                    numeric[columnIndex] && 'text-right',
                  )}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tab.rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-b border-border last:border-0">
                {row.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    className={cn(
                      'px-2 py-1.5 text-text-primary',
                      numeric[cellIndex] && 'text-right tabular-nums',
                    )}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-2xs text-text-muted">{t('projects.canvas.rowCount', { count: tab.rows.length })}</p>
    </div>
  )
}

export function CanvasKindBody({ canvas, editable = false }: { canvas: ProjectCanvas; editable?: boolean }) {
  const kind = canvasKindOf(canvas.kind)
  const framed = kind === 'diagram' || kind === 'drawing' || kind === 'image'
  return (
    <div className={cn('min-h-[12rem]', framed && 'flex flex-1 items-center justify-center')}>
      {kind === 'document' ? <DocumentBody source={canvas.source} title={canvas.title} /> : null}
      {kind === 'diagram' ? <DiagramBody source={canvas.source} title={canvas.title} /> : null}
      {kind === 'drawing' ? <DrawingBody source={canvas.source} /> : null}
      {kind === 'image' ? <ImageBody source={canvas.source} /> : null}
      {kind === 'code' ? <CodeBody source={canvas.source} language={canvas.language} /> : null}
      {kind === 'email' ? <EmailBody canvas={canvas} /> : null}
      {kind === 'sheet' ? <SheetBody canvas={canvas} /> : null}
      {kind === 'design' ? <DesignBoard canvas={canvas} editable={editable} /> : null}
    </div>
  )
}
