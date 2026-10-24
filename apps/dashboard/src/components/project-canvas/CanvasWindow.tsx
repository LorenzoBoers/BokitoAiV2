import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { Pressable } from '../ui/pressable'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import {
  Check,
  Code2,
  Copy,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  History,
  ImageIcon,
  LayoutTemplate,
  Mail,
  Minimize2,
  MoreHorizontal,
  PenTool,
  RotateCcw,
  Workflow,
  X,
} from 'lucide-react'
import { CANVAS_ICON } from '../../lib/entity-icons'
import {
  downloadSheet,
  exportSheetToGoogle,
  listCanvasRevisions,
  notifyCanvasUpdated,
  restoreCanvasRevision,
  type CanvasRevisionSummary,
  type ProjectCanvas,
} from '../../lib/project-canvas-api'
import { asString, canvasKindOf, type CanvasKind, type CanvasNode } from '../../lib/project-canvas/types'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { Callout } from '../ui/callout'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'

type IconComponent = ComponentType<{ size?: number; className?: string; 'aria-hidden'?: boolean }>

const KIND_ICON: Record<CanvasKind, IconComponent> = {
  dashboard: CANVAS_ICON,
  document: FileText,
  diagram: Workflow,
  drawing: PenTool,
  image: ImageIcon,
  code: Code2,
  email: Mail,
  sheet: FileSpreadsheet,
  design: LayoutTemplate,
}

/** Text kinds read best at a fixed line length, like a document page. */
const READING_KINDS = new Set<CanvasKind>(['document', 'email'])

type DownloadOption = { key: string; label: string; run: () => Promise<void> | void }

function fileStem(title: string): string {
  return (title || 'canvas').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'canvas'
}

function saveText(filename: string, text: string, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function parsed(source: string): Record<string, unknown> {
  try {
    const data = JSON.parse(source || '{}')
    return data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** Headings and figures, so a dashboard can be copied without its block source. */
export function dashboardPlainText(node: CanvasNode | null | undefined): string {
  const lines: string[] = []
  const walk = (current: CanvasNode | null | undefined) => {
    if (!current) return
    const props = current.props || {}
    if (current.type === 'Heading' || current.type === 'Text' || current.type === 'Callout') {
      const text = asString(props.text)
      if (text) lines.push(text)
    } else if (current.type === 'Stat') {
      const line = [asString(props.label || props.title), asString(props.value)].filter(Boolean).join(': ')
      if (line) lines.push(line)
    } else if (
      current.type === 'BarChart' ||
      current.type === 'LineChart' ||
      current.type === 'PieChart' ||
      current.type === 'Table'
    ) {
      const title = asString(props.title)
      if (title) lines.push(title)
    }
    for (const child of current.children || []) walk(child)
  }
  walk(node ?? null)
  return lines.join('\n')
}

function useDownloads(canvas: ProjectCanvas | null): DownloadOption[] {
  const { t } = useTranslation('nav')
  if (!canvas) return []
  const kind = canvasKindOf(canvas.kind)
  const stem = fileStem(canvas.title)
  const source = canvas.source || ''
  const file = (ext: string, text: string, type?: string): DownloadOption => ({
    key: ext,
    label: t('projects.canvas.downloadAs', { type: `.${ext}` }),
    run: () => saveText(`${stem}.${ext}`, text, type),
  })
  switch (kind) {
    case 'sheet':
      return [
        { key: 'csv', label: t('projects.canvas.exportCsv'), run: () => downloadSheet(canvas.id, 'csv', `${stem}.csv`) },
        { key: 'xlsx', label: t('projects.canvas.exportExcel'), run: () => downloadSheet(canvas.id, 'xlsx', `${stem}.xlsx`) },
        {
          key: 'google',
          label: t('projects.canvas.exportGoogle'),
          run: async () => {
            const created = await exportSheetToGoogle(canvas.id)
            if (created.url) window.open(created.url, '_blank', 'noopener,noreferrer')
          },
        },
      ]
    case 'document':
      return [file('md', source, 'text/markdown;charset=utf-8')]
    case 'diagram':
      return [file('mmd', source)]
    case 'drawing':
      return [file('svg', source, 'image/svg+xml')]
    case 'code':
      return [file(canvas.language || 'txt', source)]
    case 'email': {
      const body = parsed(source).body_html
      return [file('html', typeof body === 'string' ? body : '', 'text/html;charset=utf-8')]
    }
    case 'design':
      return source ? [file('json', source, 'application/json')] : []
    case 'dashboard': {
      const text = dashboardPlainText(canvas.tree)
      return text ? [file('md', text, 'text/markdown;charset=utf-8')] : []
    }
    case 'image': {
      const url = parsed(source).url
      if (typeof url !== 'string' || !url) return []
      return [
        {
          key: 'image',
          label: t('projects.canvas.download'),
          run: () => {
            window.open(url, '_blank', 'noopener,noreferrer')
          },
        },
      ]
    }
    default:
      return source ? [file('jsx', source)] : []
  }
}

type Props = {
  /** The loaded canvas. Without it the window shows the title and the body only. */
  canvas: ProjectCanvas | null
  title: string
  kind: CanvasKind
  /** The rendered snapshot (dashboard tree or kind body). */
  children: ReactNode
  /** Header actions (view switch, copy, download). Off for thumbnails and pickers. */
  actions?: boolean
  /** Lets the operator flip to the stored source. */
  allowSource?: boolean
  /** Opens the canvas on its own page. */
  openHref?: string | null
  /** Opens the canvas beside the conversation instead of leaving the thread. */
  onOpen?: () => void
  onRefresh?: () => void
  /** Collapses the open canvas pane (window chrome). */
  onMinimize?: () => void
  onClose?: () => void
  /** Extra items at the bottom of the more menu (for example Delete). */
  menu?: ReactNode
  /** Quiet facts under the kind line: agent, updated, folder. */
  caption?: ReactNode
  /** Drops a starter into the conversation composer. */
  onAsk?: () => void
  /** Shown under the title instead of the kind and version. */
  status?: ReactNode
  muted?: boolean
  className?: string
  bodyClassName?: string
  'data-testid'?: string
}

/** One window for every canvas kind: title bar with actions, then the canvas. */
export function CanvasWindow({
  canvas,
  title,
  kind,
  children,
  actions = true,
  allowSource = true,
  openHref,
  onOpen,
  onRefresh,
  onMinimize,
  onClose,
  menu,
  caption,
  onAsk,
  status,
  muted = false,
  className,
  bodyClassName,
  'data-testid': testId,
}: Props) {
  const { t } = useTranslation('nav')
  const [view, setView] = useState<'preview' | 'code'>('preview')
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [revisions, setRevisions] = useState<CanvasRevisionSummary[]>([])
  const copiedTimer = useRef<number | null>(null)
  const downloads = useDownloads(canvas)
  const Icon = KIND_ICON[kind] ?? CANVAS_ICON
  const source = canvas?.source || ''
  const copyText = kind === 'dashboard' ? dashboardPlainText(canvas?.tree) : source
  const showActions = actions && Boolean(canvas)
  const showCode = view === 'code' && allowSource && Boolean(source)
  const hasSourceToggle = allowSource && Boolean(source)
  const hasMoreMenu =
    showActions &&
    (hasSourceToggle || Boolean(copyText) || downloads.length > 0 || Boolean(onRefresh) || Boolean(menu) || Boolean(canvas?.id))

  useEffect(
    () => () => {
      if (copiedTimer.current) window.clearTimeout(copiedTimer.current)
    },
    [],
  )

  useEffect(() => {
    if (!showActions || !canvas?.id) return
    let cancel = false
    listCanvasRevisions(canvas.id)
      .then((items) => {
        if (!cancel) setRevisions(items)
      })
      .catch(() => {
        if (!cancel) setRevisions([])
      })
    return () => {
      cancel = true
    }
  }, [showActions, canvas?.id, canvas?.revision])

  async function onRestore(revision: number) {
    if (!canvas?.id) return
    setBusy(true)
    setError('')
    try {
      const saved = await restoreCanvasRevision(canvas.id, revision)
      notifyCanvasUpdated(saved)
      onRefresh?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('projects.canvas.restoreFailed'))
    } finally {
      setBusy(false)
    }
  }

  async function onCopy() {
    if (!copyText) return
    try {
      await navigator.clipboard.writeText(copyText)
      setCopied(true)
      if (copiedTimer.current) window.clearTimeout(copiedTimer.current)
      copiedTimer.current = window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setError(t('projects.canvas.copyFailed'))
    }
  }

  async function runDownload(option: DownloadOption) {
    setBusy(true)
    setError('')
    try {
      await option.run()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('projects.canvas.exportFailed'))
    } finally {
      setBusy(false)
    }
  }

  const meta =
    status ??
    [t(`projects.canvas.kinds.${kind}`), canvas?.revision ? t('projects.canvas.version', { n: canvas.revision }) : '']
      .filter(Boolean)
      .join(' · ')

  const heading = (
    <span className="flex min-w-0 items-center gap-2">
      <Icon size={16} className={cn('shrink-0', muted ? 'text-text-muted' : 'text-accent')} aria-hidden />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-text-heading">{title}</span>
        {meta ? <span className="block truncate text-2xs text-text-muted">{meta}</span> : null}
        {caption ? <span className="mt-0.5 block truncate text-2xs text-text-muted">{caption}</span> : null}
      </span>
    </span>
  )

  return (
    <Card
      className={cn(
        'flex min-h-0 flex-col overflow-hidden rounded-xl text-left',
        muted && 'opacity-60',
        className,
      )}
      aria-label={title}
      data-testid={testId ?? 'canvas-window'}
    >
      <header
        className="flex min-h-11 items-center gap-2 border-b border-border px-3 py-1.5"
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('button,a,[role="menu"]')) event.stopPropagation()
        }}
      >
        <div className="min-w-0 flex-1">
          {onOpen && actions ? (
            <Pressable
              type="button"
              onClick={onOpen}
              className="block min-w-0 rounded-md text-left hover:opacity-90"
              title={t('projects.canvas.openFull')}
            >
              {heading}
            </Pressable>
          ) : openHref && actions ? (
            <Link to={openHref} className="block min-w-0 rounded-md no-underline hover:opacity-90" title={t('projects.canvas.openFull')}>
              {heading}
            </Link>
          ) : (
            heading
          )}
        </div>
        {showActions || onMinimize || onClose ? (
          <div className="flex shrink-0 items-center gap-1">
            {onAsk ? (
              <Button type="button" size="xs" variant="ghost" onClick={onAsk}>
                {t('projects.canvas.askShort')}
              </Button>
            ) : null}
            {hasMoreMenu ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    size="iconSm"
                    variant="ghost"
                    className="text-text-secondary"
                    aria-label={t('projects.canvas.moreActions')}
                    title={t('projects.canvas.moreActions')}
                  >
                    <MoreHorizontal size={14} aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[200px]">
                  {downloads.map((option) => (
                    <DropdownMenuItem
                      key={option.key}
                      disabled={busy}
                      onClick={() => void runDownload(option)}
                    >
                      <Download size={14} className="mr-2" aria-hidden />
                      {option.label}
                    </DropdownMenuItem>
                  ))}
                  {copyText ? (
                    <DropdownMenuItem onClick={() => void onCopy()}>
                      {copied ? (
                        <Check size={14} className="mr-2" aria-hidden />
                      ) : (
                        <Copy size={14} className="mr-2" aria-hidden />
                      )}
                      {copied ? t('projects.canvas.copied') : t('projects.canvas.copy')}
                    </DropdownMenuItem>
                  ) : null}
                  {(downloads.length > 0 || Boolean(source)) && (hasSourceToggle || onRefresh) ? (
                    <DropdownMenuSeparator />
                  ) : null}
                  {hasSourceToggle ? (
                    <DropdownMenuItem onClick={() => setView(view === 'code' ? 'preview' : 'code')}>
                      {view === 'code' ? (
                        <Eye size={14} className="mr-2" aria-hidden />
                      ) : (
                        <Code2 size={14} className="mr-2" aria-hidden />
                      )}
                      {view === 'code' ? t('projects.canvas.preview') : t('projects.canvas.showSource')}
                    </DropdownMenuItem>
                  ) : null}
                  {onRefresh ? (
                    <DropdownMenuItem onClick={onRefresh}>
                      <RotateCcw size={14} className="mr-2" aria-hidden />
                      {t('projects.detail.refresh')}
                    </DropdownMenuItem>
                  ) : null}
                  {canvas?.id ? (
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <History size={14} className="mr-2" aria-hidden />
                        {t('projects.canvas.versions')}
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="max-h-64 overflow-auto">
                        <DropdownMenuItem disabled>
                          {t('projects.canvas.versionCurrent', { n: canvas.revision })}
                        </DropdownMenuItem>
                        {revisions.map((row) => (
                          <DropdownMenuItem
                            key={row.revision}
                            disabled={busy}
                            onClick={() => void onRestore(row.revision)}
                          >
                            {t('projects.canvas.version', { n: row.revision })}
                          </DropdownMenuItem>
                        ))}
                        {revisions.length === 0 ? (
                          <DropdownMenuItem disabled>{t('projects.canvas.noVersions')}</DropdownMenuItem>
                        ) : null}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  ) : null}
                  {menu ? (
                    <>
                      {downloads.length > 0 || Boolean(source) || hasSourceToggle || Boolean(onRefresh) ? (
                        <DropdownMenuSeparator />
                      ) : null}
                      {menu}
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {onMinimize ? (
              <Button
                type="button"
                size="iconSm"
                variant="ghost"
                className="text-text-secondary"
                onClick={onMinimize}
                aria-label={t('projects.canvas.minimize')}
                title={t('projects.canvas.minimize')}
              >
                <Minimize2 size={14} aria-hidden />
              </Button>
            ) : null}
            {onClose ? (
              <Button
                type="button"
                size="iconSm"
                variant="ghost"
                className="text-text-secondary"
                onClick={onClose}
                aria-label={t('projects.canvas.close')}
                title={t('projects.canvas.close')}
              >
                <X size={14} aria-hidden />
              </Button>
            ) : null}
          </div>
        ) : null}
      </header>
      {error ? (
        <div className="border-b border-border px-3 py-2">
          <Callout tone="error">{error}</Callout>
        </div>
      ) : null}
      <div className={cn('relative min-h-0 overflow-auto', bodyClassName)}>
        {showCode ? (
          <pre className="min-h-full bg-bg-input/30 p-4 font-mono text-xs leading-relaxed text-text-secondary">
            <code>{source}</code>
          </pre>
        ) : (
          <div
            className={cn(
              READING_KINDS.has(kind)
                ? 'mx-auto w-full max-w-3xl px-6 py-5'
                : 'flex min-h-full flex-col p-4',
            )}
          >
            {children}
          </div>
        )}
      </div>
    </Card>
  )
}