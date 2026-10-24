import type { TFunction } from 'i18next'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { File, Image as ImageIcon, LayoutGrid, List, Plus, Table2, Tags } from 'lucide-react'
import { CANVAS_ICON, ENTITY_ICONS } from '../../lib/entity-icons'
import { CANVAS_KINDS } from '../../lib/project-canvas/types'
import {
  listFolderContents,
  type FolderContentItem,
  type FolderContentLabel,
  type FolderContentsPage,
} from '../../lib/projects-api'
import { projectHubPath } from '../../lib/messages-paths'
import { withNavReveal } from '../../lib/nav-reveal'
import { timeAgo } from '../../lib/time-ago'
import { cn } from '../../lib/utils'
import { ApiErrorBanner, formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { ChannelGlyph, channelKind } from '../ui/ChannelGlyph'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { EmptyState } from '../ui/empty-state'
import { MetaLine } from '../ui/meta-line'
import { SearchField } from '../ui/search-field'
import { SegmentedControl } from '../ui/segmented-control'
import { ConversationRowsSkeleton, CardGridSkeleton } from '../ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table'
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs'
import { ThreadStatusDot } from '../ui/ThreadStatusDot'
import { threadStatusLabel } from '../../lib/status-labels'

const VIEW_KEY = 'bokito.folder.contents.view'
const FolderIcon = ENTITY_ICONS.project
const ROW_GRID = 'grid grid-cols-[2rem_minmax(0,1.5fr)_minmax(8rem,1fr)_4.5rem_6rem] items-center gap-x-3'

type ContentsView = 'rows' | 'cards' | 'sheet'

export function contentsCountLabel(count: number): string {
  return count > 99 ? '99+' : String(count)
}

function storedView(): ContentsView {
  try {
    const raw = localStorage.getItem(VIEW_KEY)
    if (raw === 'cards' || raw === 'sheet') return raw
    return 'rows'
  } catch {
    return 'rows'
  }
}

function rememberView(view: ContentsView) {
  try {
    localStorage.setItem(VIEW_KEY, view)
  } catch {
    /* private mode */
  }
}

/**
 * The folder as a container: search, a type tab, a label filter, and one
 * list of subfolders, conversations, images, files and canvases.
 */
export function FolderContents({
  projectId,
  canEdit,
  onCreateFolder,
  refreshKey,
}: {
  projectId: string
  canEdit: boolean
  onCreateFolder?: () => void
  refreshKey?: number
}) {
  const { t } = useTranslation('nav')
  const [searchParams, setSearchParams] = useSearchParams()
  const type = searchParams.get('type') || 'all'
  const urlQ = searchParams.get('q') ?? ''
  const labelIds = useMemo(
    () => (searchParams.get('labels') ?? '').split(',').map((id) => id.trim()).filter(Boolean),
    [searchParams],
  )
  const urlView = searchParams.get('view')
  const view: ContentsView = urlView === 'cards' || urlView === 'rows' || urlView === 'sheet' ? urlView : storedView()

  const [draftQ, setDraftQ] = useState(urlQ)
  const [page, setPage] = useState<FolderContentsPage | null>(null)
  const [items, setItems] = useState<FolderContentItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  useEffect(() => {
    setDraftQ(urlQ)
  }, [urlQ])

  const write = useCallback(
    (patch: { type?: string; q?: string; labels?: string[]; view?: ContentsView }) => {
      const next = new URLSearchParams(searchParams)
      if (patch.type !== undefined) {
        if (!patch.type || patch.type === 'all') next.delete('type')
        else next.set('type', patch.type)
      }
      if (patch.q !== undefined) {
        if (patch.q) next.set('q', patch.q)
        else next.delete('q')
      }
      if (patch.labels !== undefined) {
        if (patch.labels.length) next.set('labels', patch.labels.join(','))
        else next.delete('labels')
      }
      if (patch.view !== undefined) {
        next.set('view', patch.view)
        rememberView(patch.view)
      }
      setSearchParams(next, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  useEffect(() => {
    if (draftQ === urlQ) return
    const handle = window.setTimeout(() => write({ q: draftQ.trim() }), 300)
    return () => window.clearTimeout(handle)
  }, [draftQ, urlQ, write])

  const labelKey = labelIds.join(',')
  const load = useCallback(async () => {
    setPage(null)
    setError(null)
    try {
      const result = await listFolderContents(projectId, {
        type,
        q: urlQ,
        labelIds,
        page: 1,
        perPage: 40,
      })
      setPage(result)
      setItems(result.items)
    } catch (err) {
      setError(formatApiErrorMessage(err, t('projects.contents.loadError')))
      setItems([])
    }
  }, [labelIds, projectId, t, type, urlQ])

  useEffect(() => {
    void load()
  }, [load, refreshKey, labelKey])

  const loadMore = async () => {
    if (!page?.next_page || loadingMore) return
    setLoadingMore(true)
    try {
      const result = await listFolderContents(projectId, {
        type,
        q: urlQ,
        labelIds,
        page: page.next_page,
        perPage: 40,
      })
      setPage(result)
      setItems((prev) => {
        const seen = new Set(prev.map((row) => `${row.kind}:${row.id}`))
        return [...prev, ...result.items.filter((row) => !seen.has(`${row.kind}:${row.id}`))]
      })
    } catch (err) {
      setError(formatApiErrorMessage(err, t('projects.contents.loadError')))
    } finally {
      setLoadingMore(false)
    }
  }

  const counts = page?.counts
  const tabs = useMemo(() => {
    const rows: { value: string; label: string; count?: number }[] = [
      { value: 'all', label: t('projects.contents.tabAll', { count: contentsCountLabel(counts?.all ?? 0) }) },
    ]
    const add = (value: string, label: string, count: number) => {
      if (count > 0 || type === value) rows.push({ value, label, count })
    }
    add('conversation', t('projects.contents.tabConversations'), counts?.conversation ?? 0)
    add('image', t('projects.contents.tabImages'), counts?.image ?? 0)
    add('file', t('projects.contents.tabFiles'), counts?.file ?? 0)
    for (const kind of CANVAS_KINDS) {
      const count = counts?.canvas?.[kind] ?? 0
      add(`canvas:${kind}`, t(`projects.canvas.kinds.${kind}`), count)
    }
    add('folder', t('projects.contents.tabFolders'), counts?.folder ?? 0)
    return rows
  }, [counts, t, type])

  const showCreate = Boolean(canEdit && onCreateFolder && (type === 'all' || type === 'folder'))
  const folderRows = items.filter((row) => row.kind === 'folder')
  const otherRows = items.filter((row) => row.kind !== 'folder')
  const filtering = Boolean(urlQ || labelIds.length)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchField
          value={draftQ}
          onChange={setDraftQ}
          placeholder={t('projects.contents.search')}
          aria-label={t('projects.contents.search')}
          size="sm"
          className="min-w-[12rem] flex-1"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" size="sm" variant="secondary" aria-label={t('projects.contents.labels')}>
              <Tags size={14} aria-hidden />
              {t('projects.contents.labels')}
              {labelIds.length > 0 ? (
                <span className="tabular-nums text-text-muted">{labelIds.length}</span>
              ) : null}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-80 min-w-[14rem] overflow-auto">
            {(page?.labels ?? []).length === 0 ? (
              <EmptyState tone="plain" size="sm" className="px-2 py-3" title={t('projects.contents.labelsEmpty')} />
            ) : (
              page?.labels.map((label) => (
                <DropdownMenuCheckboxItem
                  key={label.id}
                  checked={labelIds.includes(label.id)}
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={(checked) => {
                    const next = checked
                      ? [...labelIds, label.id]
                      : labelIds.filter((id) => id !== label.id)
                    write({ labels: next })
                  }}
                >
                  <span className="flex w-full min-w-0 items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">{label.name}</span>
                    {label.count != null ? (
                      <span className="tabular-nums text-text-muted">{label.count}</span>
                    ) : null}
                  </span>
                </DropdownMenuCheckboxItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <SegmentedControl<ContentsView>
          size="sm"
          value={view}
          onChange={(next) => write({ view: next })}
          aria-label={t('projects.contents.view')}
          options={[
            { value: 'rows', label: t('projects.contents.rows'), icon: <List size={14} aria-hidden /> },
            { value: 'cards', label: t('projects.contents.cards'), icon: <LayoutGrid size={14} aria-hidden /> },
            { value: 'sheet', label: t('projects.contents.sheet'), icon: <Table2 size={14} aria-hidden /> },
          ]}
        />
      </div>

      <Tabs value={tabs.some((tab) => tab.value === type) ? type : 'all'} onValueChange={(next) => write({ type: next })}>
        <TabsList className="h-auto min-h-9 w-full flex-wrap justify-start">
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.value.startsWith('canvas:') ? (
                <CANVAS_ICON size={14} className="shrink-0 opacity-80" aria-hidden />
              ) : null}
              {tab.label}
              {tab.count != null && tab.count > 0 && tab.value !== 'all' ? (
                <span className="rounded-full bg-bg-muted/60 px-1.5 text-2xs tabular-nums text-text-muted">
                  {contentsCountLabel(tab.count)}
                </span>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {page == null && !error ? (
        view === 'cards' ? <CardGridSkeleton cards={6} /> : <ConversationRowsSkeleton rows={5} />
      ) : error && items.length === 0 ? (
        <ApiErrorBanner message={error} onRetry={() => void load()} />
      ) : items.length === 0 && !showCreate ? (
        <EmptyState
          tone="card"
          size="sm"
          title={filtering ? t('projects.contents.emptyFiltered') : t('projects.contents.empty')}
        />
      ) : view === 'sheet' ? (
        <ContentSheet
          folderRows={folderRows}
          otherRows={otherRows}
          projectId={projectId}
          showCreate={showCreate}
          onCreateFolder={onCreateFolder}
          empty={items.length === 0 ? (filtering ? t('projects.contents.emptyFiltered') : t('projects.contents.empty')) : null}
        />
      ) : view === 'rows' ? (
        <Card className="overflow-x-auto p-1">
          <div className="min-w-[40rem] divide-y divide-border/50">
            {folderRows.map((item) => (
              <ContentRow key={`${item.kind}:${item.id}`} item={item} projectId={projectId} />
            ))}
            {showCreate ? <NewFolderRow onClick={onCreateFolder!} /> : null}
            {otherRows.map((item) => (
              <ContentRow key={`${item.kind}:${item.id}`} item={item} projectId={projectId} />
            ))}
            {items.length === 0 ? (
              <p className="px-3 py-4 text-sm text-text-muted">
                {filtering ? t('projects.contents.emptyFiltered') : t('projects.contents.empty')}
              </p>
            ) : null}
          </div>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {folderRows.map((item) => (
            <ContentCard key={`${item.kind}:${item.id}`} item={item} projectId={projectId} />
          ))}
          {showCreate ? <NewFolderCard onClick={onCreateFolder!} /> : null}
          {otherRows.map((item) => (
            <ContentCard key={`${item.kind}:${item.id}`} item={item} projectId={projectId} />
          ))}
        </div>
      )}

      {page?.next_page ? (
        <Button type="button" size="sm" variant="ghost" disabled={loadingMore} onClick={() => void loadMore()}>
          {loadingMore ? t('projects.contents.loadingMore') : t('projects.contents.loadMore')}
        </Button>
      ) : null}
    </div>
  )
}

function NewFolderRow({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation('nav')
  return (
    <div className="px-3">
      <Button type="button" variant="ghost" onClick={onClick} className="h-auto w-full justify-start gap-3 px-0 py-2 text-text-muted">
        <span className="flex h-8 w-8 items-center justify-center">
          <Plus size={14} aria-hidden />
        </span>
        {t('projects.detail.newFolder')}
      </Button>
    </div>
  )
}

function NewFolderCard({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation('nav')
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      className="h-auto min-h-[64px] border border-dashed border-border text-text-muted"
    >
      <Plus size={14} aria-hidden />
      {t('projects.detail.newFolder')}
    </Button>
  )
}

function itemTitle(item: FolderContentItem, fallback: string) {
  return item.title.trim() || fallback
}

function detailText(item: FolderContentItem, t: TFunction): string {
  if (item.kind === 'folder') {
    const bits = [t('projects.detail.folderCounts', { open: item.open_count ?? 0, closed: item.closed_count ?? 0 })]
    if ((item.child_count ?? 0) > 0) bits.push(String(t('projects.page.folders', { count: item.child_count })))
    return bits.join(' · ')
  }
  if (item.kind === 'canvas') {
    const kind = kindLabel(item, t)
    const sub = (item.subtitle ?? '').trim()
    return sub ? `${kind} · ${sub}` : kind
  }
  return (item.subtitle ?? '').trim()
}

function kindLabel(item: FolderContentItem, t: TFunction): string {
  if (item.kind === 'canvas') return t(`projects.canvas.kinds.${item.canvas_kind || 'dashboard'}`)
  if (item.kind === 'folder') return t('projects.contents.kindFolder')
  if (item.kind === 'conversation') return t('projects.contents.kindConversation')
  if (item.kind === 'image') return t('projects.contents.kindImage')
  return t('projects.contents.kindFile')
}

function channelName(channel: string | null | undefined, t: TFunction): string {
  if (!channel) return ''
  const kind = channelKind(channel)
  return t(`composer.channel.${kind}`, { ns: 'communication', defaultValue: kind })
}

function MarkSlot({ item }: { item: FolderContentItem }) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center">
      <ItemMark item={item} />
    </span>
  )
}

function LabelChips({ item, nowrap = false }: { item: FolderContentItem; nowrap?: boolean }) {
  if (item.labels.length === 0) return null
  return (
    <span className={cn('flex min-w-0 gap-1', nowrap ? 'flex-nowrap overflow-hidden' : 'flex-wrap')}>
      {item.labels.map((label) => (
        <Badge key={label.id} size="sm" className={nowrap ? 'shrink-0' : undefined}>
          {label.name}
        </Badge>
      ))}
    </span>
  )
}

function ContentRow({ item, projectId }: { item: FolderContentItem; projectId: string }) {
  const { t } = useTranslation('nav')
  const title = itemTitle(item, t('projects.contents.noTitle'))
  const detail = detailText(item, t)
  return (
    <div className={cn(ROW_GRID, 'rounded-lg px-3 py-2 hover:bg-bg-hover')}>
      <MarkSlot item={item} />
      <ItemLink item={item} projectId={projectId} className="min-w-0">
        <span className={cn('block truncate-fade text-sm text-text-primary', item.unread && 'font-semibold text-text-heading')}>
          {title}
        </span>
        {detail ? <span className="block truncate text-xs text-text-muted">{detail}</span> : null}
      </ItemLink>
      <LabelChips item={item} />
      <span className="justify-self-end">
        <ThreadLink item={item} projectId={projectId} />
      </span>
      <span className="justify-self-end whitespace-nowrap text-right text-2xs tabular-nums text-text-muted">
        {item.updated_at ? timeAgo(item.updated_at, t) : ''}
      </span>
    </div>
  )
}

function ContentSheet({
  folderRows,
  otherRows,
  projectId,
  showCreate,
  onCreateFolder,
  empty,
}: {
  folderRows: FolderContentItem[]
  otherRows: FolderContentItem[]
  projectId: string
  showCreate: boolean
  onCreateFolder?: () => void
  empty: string | null
}) {
  const { t } = useTranslation('nav')
  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead className="w-[24%]">{t('projects.contents.colName')}</TableHead>
          <TableHead className="w-[9%]">{t('projects.contents.colKind')}</TableHead>
          <TableHead className="w-[18%]">{t('projects.contents.colDetail')}</TableHead>
          <TableHead className="w-[10%]">{t('projects.contents.colChannel')}</TableHead>
          <TableHead className="w-[8%]">{t('projects.contents.colStatus')}</TableHead>
          <TableHead className="w-[16%]">{t('projects.contents.colLabels')}</TableHead>
          <TableHead className="w-[9%] text-right">{t('projects.contents.colUpdated')}</TableHead>
          <TableHead className="w-[6%]">{t('projects.contents.openThread')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {folderRows.map((item) => (
          <SheetRow key={`${item.kind}:${item.id}`} item={item} projectId={projectId} />
        ))}
        {showCreate && onCreateFolder ? (
          <TableRow>
            <TableCell colSpan={8}>
              <Button type="button" variant="ghost" onClick={onCreateFolder} className="justify-start px-0 text-text-muted">
                <Plus size={14} aria-hidden />
                {t('projects.detail.newFolder')}
              </Button>
            </TableCell>
          </TableRow>
        ) : null}
        {otherRows.map((item) => (
          <SheetRow key={`${item.kind}:${item.id}`} item={item} projectId={projectId} />
        ))}
        {empty ? (
          <TableRow>
            <TableCell colSpan={8} className="text-text-muted">
              {empty}
            </TableCell>
          </TableRow>
        ) : null}
      </TableBody>
    </Table>
  )
}

function SheetRow({ item, projectId }: { item: FolderContentItem; projectId: string }) {
  const { t } = useTranslation('nav')
  const title = itemTitle(item, t('projects.contents.noTitle'))
  const detail = detailText(item, t)
  const channel = item.kind === 'conversation' ? channelName(item.channel, t) : ''
  const status = item.kind === 'conversation' ? threadStatusLabel(item.status, t) : ''
  return (
    <TableRow>
      <TableCell className="overflow-hidden">
        <ItemLink item={item} projectId={projectId} className="flex min-w-0 items-center gap-2">
          <MarkSlot item={item} />
          <span className={cn('min-w-0 truncate', item.unread && 'font-semibold text-text-heading')}>{title}</span>
        </ItemLink>
      </TableCell>
      <TableCell className="overflow-hidden whitespace-nowrap text-text-secondary">{kindLabel(item, t)}</TableCell>
      <TableCell className="overflow-hidden text-text-secondary">
        {detail ? <span className="block truncate">{detail}</span> : <Blank />}
      </TableCell>
      <TableCell className="overflow-hidden whitespace-nowrap">
        {channel ? (
          <span className="inline-flex items-center gap-1.5 text-text-secondary">
            <ChannelGlyph channel={item.channel ?? 'email'} size={14} />
            {channel}
          </span>
        ) : (
          <Blank />
        )}
      </TableCell>
      <TableCell className="overflow-hidden whitespace-nowrap text-text-secondary">{status || <Blank />}</TableCell>
      <TableCell className="overflow-hidden">
        {item.labels.length > 0 ? <LabelChips item={item} nowrap /> : <Blank />}
      </TableCell>
      <TableCell className="overflow-hidden whitespace-nowrap text-right tabular-nums text-text-muted">
        {item.updated_at ? timeAgo(item.updated_at, t) : <Blank />}
      </TableCell>
      <TableCell>
        {item.signal_id && item.kind !== 'conversation' && item.kind !== 'folder' ? (
          <ThreadLink item={item} projectId={projectId} />
        ) : (
          <Blank />
        )}
      </TableCell>
    </TableRow>
  )
}

function Blank() {
  return <span className="text-text-muted">—</span>
}

function ContentCard({ item, projectId }: { item: FolderContentItem; projectId: string }) {
  const { t } = useTranslation('nav')
  const title = itemTitle(item, t('projects.contents.noTitle'))
  return (
    <Card interactive className="flex h-full flex-col overflow-hidden">
      <ItemLink item={item} projectId={projectId} className="flex flex-1 flex-col gap-2 p-3">
        {item.thumb_url ? (
          <img src={item.thumb_url} alt="" className="h-28 w-full rounded-md object-cover" />
        ) : (
          <span className="flex h-10 items-center">
            <ItemMark item={item} />
          </span>
        )}
        <span className={cn('truncate-fade text-sm font-medium text-text-heading', item.unread && 'font-semibold')}>
          {title}
        </span>
        <ItemMeta item={item} />
        {item.updated_at ? (
          <span className="text-2xs tabular-nums text-text-muted">{timeAgo(item.updated_at, t)}</span>
        ) : null}
      </ItemLink>
      {item.signal_id && item.kind !== 'conversation' && item.kind !== 'folder' ? (
        <div className="px-3 pb-3">
          <ThreadLink item={item} projectId={projectId} />
        </div>
      ) : null}
    </Card>
  )
}

function ItemMark({ item }: { item: FolderContentItem }) {
  const { t } = useTranslation('nav')
  if (item.kind === 'conversation') {
    return (
      <span className="flex items-center gap-1">
        <ThreadStatusDot status={item.status} unread={Boolean(item.unread)} title={threadStatusLabel(item.status, t)} />
        <ChannelGlyph channel={item.channel ?? 'email'} size={14} />
      </span>
    )
  }
  if (item.kind === 'folder') {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent" aria-hidden>
        <FolderIcon size={15} />
      </span>
    )
  }
  if (item.kind === 'canvas') {
    return <CANVAS_ICON size={16} className="shrink-0 text-text-muted" aria-hidden />
  }
  if (item.kind === 'image' && item.thumb_url) {
    return <img src={item.thumb_url} alt="" className="h-8 w-8 shrink-0 rounded-md object-cover" />
  }
  const Icon = item.kind === 'image' ? ImageIcon : File
  return <Icon size={16} className="shrink-0 text-text-muted" aria-hidden />
}

function ItemMeta({ item }: { item: FolderContentItem }) {
  const { t } = useTranslation('nav')
  const bits: string[] = []
  if (item.kind === 'folder') {
    bits.push(t('projects.detail.folderCounts', { open: item.open_count ?? 0, closed: item.closed_count ?? 0 }))
    if ((item.child_count ?? 0) > 0) bits.push(t('projects.page.folders', { count: item.child_count }))
  } else if (item.kind === 'canvas') {
    bits.push(kindLabel(item, t))
    if (item.subtitle) bits.push(item.subtitle)
  } else if (item.subtitle) {
    bits.push(item.subtitle)
  }
  return (
    <span className="block min-w-0">
      {bits.length > 0 ? <MetaLine>{bits.join(' · ')}</MetaLine> : null}
      {item.labels.length > 0 ? (
        <span className="mt-1 flex flex-wrap gap-1">
          {item.labels.map((label) => (
            <Badge key={label.id} size="sm">
              {label.name}
            </Badge>
          ))}
        </span>
      ) : null}
    </span>
  )
}

function ThreadLink({ item, projectId }: { item: FolderContentItem; projectId: string }) {
  const { t } = useTranslation('nav')
  if (!item.signal_id || item.kind === 'conversation' || item.kind === 'folder') return null
  return (
    <Link
      to={withNavReveal(projectHubPath(projectId, 'open', item.signal_id))}
      className="shrink-0 text-2xs text-text-muted hover:text-accent"
    >
      {t('projects.contents.openThread')}
    </Link>
  )
}

function ItemLink({
  item,
  projectId,
  className,
  children,
}: {
  item: FolderContentItem
  projectId: string
  className?: string
  children: ReactNode
}) {
  const [searchParams, setSearchParams] = useSearchParams()
  if (item.kind === 'canvas') {
    return (
      <Button
        type="button"
        variant="ghost"
        className={cn('h-auto justify-start whitespace-normal px-0 text-left font-normal', className)}
        onClick={() => {
          const next = new URLSearchParams(searchParams)
          next.set('canvas', item.id)
          setSearchParams(next)
        }}
      >
        {children}
      </Button>
    )
  }
  if ((item.kind === 'image' || item.kind === 'file') && item.href_target) {
    return (
      <a
        href={item.href_target}
        target="_blank"
        rel="noreferrer"
        className={cn('focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus', className)}
      >
        {children}
      </a>
    )
  }
  if (item.kind === 'image' || item.kind === 'file') {
    return <div className={className}>{children}</div>
  }
  const to = item.kind === 'conversation' ? withNavReveal(item.href_target) : item.href_target
  return (
    <Link to={to} className={cn('focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus', className)}>
      {children}
    </Link>
  )
}

export type { FolderContentLabel }
