import { useEffect, useState, type ComponentType, MouseEvent } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  BookOpen,
  CalendarClock,
  FileText,
  FolderKanban,
  Hash,
  ImageIcon,
  MessageSquare,
  MessageSquareText,
  Package,
  Plug,
  Store,
  Trash2,
  Workflow,
} from 'lucide-react'
import type { ProposalItem } from '../../lib/inbox-api'
import { CANVAS_ICON } from '../../lib/entity-icons'
import { openEntityPath, type EntityRef } from '../../lib/open-entity'
import { getCanvasById } from '../../lib/project-canvas-api'
import { renderCanvasTree } from '../../lib/project-canvas/render'
import { isEmptyCanvasTree, type CanvasNode } from '../../lib/project-canvas/types'
import { toAiAvatarProps } from '../../lib/agent-avatar'
import { cn } from '../../lib/utils'
import { BrandTile } from '../integrations/BrandMark'
import { EntityRow } from '../ui/entity-row'
import { IconTile } from '../ui/icon-tile'
import { UserAvatar } from '../ui/UserAvatar'
import { ContactAvatar } from '../ui/ContactAvatar'
import { AiAvatar } from '../ui/AiAvatar'

type IconComponent = ComponentType<{ size?: number; className?: string; 'aria-hidden'?: boolean }>

const TYPE_ICON: Partial<Record<ProposalItem['type'], IconComponent>> = {
  conversation: MessageSquare,
  trash_entry: Trash2,
  trigger: CalendarClock,
  file: FileText,
  image: ImageIcon,
  tag: Hash,
  flow: Workflow,
  project: FolderKanban,
  canvas: CANVAS_ICON,
  integration: Plug,
  marketplace: Store,
  module: Package,
  help_doc: BookOpen,
  message: MessageSquareText,
}

function itemRef(item: ProposalItem): EntityRef | null {
  switch (item.type) {
    case 'conversation':
      return { type: 'signal', id: item.id }
    case 'trash_entry':
      return { type: 'trash_entry', id: item.id }
    case 'trigger':
      return { type: 'trigger', id: item.id }
    case 'file':
      return { type: 'file', url: item.url, messageId: item.messageId, signalId: item.signalId }
    case 'image':
      return null
    case 'user':
      return { type: 'user', id: item.id }
    case 'agent':
      return { type: 'agent', id: item.id }
    case 'tag':
      return { type: 'tag', name: item.name || item.title }
    case 'flow':
      return { type: 'flow', id: item.id }
    case 'folder':
    case 'project':
      return { type: 'folder', id: item.id }
    case 'canvas':
      return { type: 'canvas', id: item.id, path: item.path }
    case 'contact':
      return { type: 'contact', id: item.id }
    case 'integration':
      return { type: 'integration', id: item.id, provider: item.provider }
    case 'marketplace':
      return { type: 'marketplace', slug: item.provider || item.id }
    case 'module':
      return { type: 'module', slug: item.slug || item.id }
    case 'help_doc':
      return { type: 'help_doc', path: item.path || item.id }
    case 'message':
      return {
        type: 'signal',
        id: item.signalId || item.id,
        messageId: item.messageId || item.id,
      }
  }
}

function shortDate(iso: string | null | undefined, locale: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(locale, { day: 'numeric', month: 'short' })
}

function brandSlugForItem(item: ProposalItem): string | null {
  if (item.type !== 'integration' && item.type !== 'marketplace') return null
  const slug = (item.provider || item.slug || item.id || '').trim().toLowerCase()
  return slug || null
}

function ItemLeading({ item }: { item: ProposalItem }) {
  if (item.type === 'user') {
    return <UserAvatar name={item.title} email={item.subtitle} avatarUrl={item.imageUrl} size={32} />
  }
  if (item.type === 'contact') {
    return <ContactAvatar name={item.title} email={item.subtitle} size={32} />
  }
  if (item.type === 'agent') {
    return <AiAvatar {...toAiAvatarProps({ name: item.title, agentId: item.id }, 'Agent')} size={32} decorative />
  }
  if ((item.type === 'file' || item.type === 'image') && item.imageUrl) {
    return (
      <span className="block h-10 w-10 overflow-hidden rounded-lg border border-border/60 bg-bg-elevated">
        <img src={item.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
      </span>
    )
  }
  const brandSlug = brandSlugForItem(item)
  if (brandSlug) {
    return <BrandTile slug={brandSlug} size="sm" />
  }
  return <IconTile icon={TYPE_ICON[item.type] ?? FileText} tone={item.missing ? 'neutral' : 'accent'} />
}

/** One object shown as a showcase card inside an agent (or chooser) bubble. */
export function ProposalItemPreview({
  item,
  onSelect,
  selected,
}: {
  item: ProposalItem
  /** When set, click chooses instead of navigating (open proposal). */
  onSelect?: (item: ProposalItem) => void
  selected?: boolean
}) {
  const { t, i18n } = useTranslation('communication')
  const typeLabel =
    item.type === 'trash_entry' && item.kind
      ? t(`proposal.binKind.${item.kind}`, { defaultValue: t('proposal.itemType.trash_entry') })
      : t(`proposal.itemType.${item.type}`, { defaultValue: item.type })
  const when =
    item.type === 'trash_entry'
      ? shortDate(item.deletedAt, i18n.language)
      : item.type === 'trigger'
        ? shortDate(item.at, i18n.language)
        : ''
  const metaParts = item.missing
    ? [t('proposal.itemMissing')]
    : [
        typeLabel,
        item.type === 'trash_entry' && when ? t('proposal.deletedOn', { date: when }) : when,
        item.subtitle,
      ].filter(Boolean)
  const row = (
    <EntityRow
      density="sm"
      interactive={!item.missing}
      leading={<ItemLeading item={item} />}
      title={item.title || typeLabel}
      meta={<span className="block truncate">{metaParts.join(' · ')}</span>}
      className={cn(
        'rounded-lg border border-border/60 bg-bg-surface',
        item.missing && 'opacity-60',
        selected && 'ring-1 ring-ai/50 border-ai/40',
      )}
      data-testid="proposal-item"
    />
  )
  if (item.missing) return row
  if (onSelect) {
    return (
      <button
        type="button"
        className="block w-full text-left"
        onClick={(e: MouseEvent) => {
          e.preventDefault()
          onSelect(item)
        }}
      >
        {row}
      </button>
    )
  }
  if (item.type === 'image' && (item.url || item.imageUrl)) {
    const href = item.url || item.imageUrl || ''
    return (
      <a href={href} target="_blank" rel="noreferrer" className="block no-underline">
        {row}
      </a>
    )
  }
  const ref = itemRef(item)
  const path = ref ? openEntityPath(ref) : item.path || null
  if (!path) return row
  if (/^https?:\/\//.test(path) || (item.type === 'file' && item.url)) {
    return (
      <a href={path} target="_blank" rel="noreferrer" className="block no-underline">
        {row}
      </a>
    )
  }
  return (
    <Link to={path} className="block no-underline">
      {row}
    </Link>
  )
}

function ImageGallery({ items }: { items: ProposalItem[] }) {
  return (
    <div className="mt-2 grid grid-cols-3 gap-1.5" data-testid="proposal-image-gallery">
      {items.map((item) => {
        const src = item.imageUrl || item.url || ''
        const href = item.url || item.imageUrl || src
        if (!src) return null
        return (
          <a
            key={`${item.type}:${item.id}`}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="group relative aspect-square overflow-hidden rounded-lg border border-border/60 bg-bg-elevated no-underline"
            title={item.title || undefined}
          >
            <img
              src={src}
              alt={item.title || ''}
              loading="lazy"
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
            />
          </a>
        )
      })}
    </div>
  )
}

function canvasHref(item: ProposalItem): string | null {
  const ref = itemRef(item)
  const path = ref ? openEntityPath(ref) : item.path || null
  return path || null
}

/** Snapshot preview under an agent reply. The whole card opens that canvas. */
export function CanvasShowcaseCard({
  item,
  onSelect,
  selected,
  compact = false,
}: {
  item: ProposalItem
  onSelect?: (item: ProposalItem) => void
  selected?: boolean
  compact?: boolean
}) {
  const { t } = useTranslation('communication')
  const [tree, setTree] = useState<CanvasNode | null>(item.preview ?? null)
  const [settled, setSettled] = useState(item.missing || !item.id)
  useEffect(() => {
    if (item.missing || !item.id) return
    let cancel = false
    getCanvasById(item.id)
      .then((canvas) => {
        if (!cancel) setTree(canvas.tree)
      })
      .catch(() => {
        /* Keep the snapshot stored on the message. */
      })
      .finally(() => {
        if (!cancel) setSettled(true)
      })
    return () => {
      cancel = true
    }
  }, [item.id, item.missing])
  const preview = tree && !isEmptyCanvasTree(tree) ? tree : null
  const card = (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-border/60 bg-bg-surface text-left',
        selected && 'ring-1 ring-ai/50 border-ai/40',
        item.missing && 'opacity-60',
      )}
      data-testid="canvas-showcase"
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <IconTile icon={CANVAS_ICON} tone={item.missing ? 'neutral' : 'accent'} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-text-primary">{item.title || t('proposal.itemType.canvas')}</p>
          {item.subtitle ? <p className="truncate text-xs text-text-muted">{item.subtitle}</p> : null}
        </div>
      </div>
      {preview ? (
        <div
          className={cn(
            'relative overflow-hidden border-t border-border/50 bg-bg-input/30',
            compact ? 'h-24' : 'h-36',
          )}
        >
          <div
            className="pointer-events-none origin-top-left p-3"
            style={{ width: '160%', transform: compact ? 'scale(0.48)' : 'scale(0.62)' }}
          >
            {renderCanvasTree(preview)}
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-bg-surface to-transparent" />
        </div>
      ) : settled ? (
        <p className="border-t border-border/50 px-3 py-3 text-xs text-text-muted">{t('proposal.canvasEmpty')}</p>
      ) : (
        <div className="h-16 border-t border-border/50 bg-bg-input/20" />
      )}
    </div>
  )
  if (item.missing) return card
  if (onSelect) {
    return (
      <button type="button" className="block w-full" onClick={() => onSelect(item)}>
        {card}
      </button>
    )
  }
  const path = canvasHref(item)
  if (!path) return card
  return (
    <Link to={path} className="block no-underline">
      {card}
    </Link>
  )
}

function isConnectorItem(item: ProposalItem): boolean {
  return item.type === 'integration' || item.type === 'marketplace'
}

/** Compact logo grid when the agent showcases several connectors at once. */
function ConnectorShowcase({
  items,
  onSelect,
  selectedIds,
}: {
  items: ProposalItem[]
  onSelect?: (item: ProposalItem) => void
  selectedIds?: Set<string>
}) {
  return (
    <div
      className="mt-2 grid gap-1.5 [grid-template-columns:repeat(auto-fill,minmax(11rem,1fr))]"
      data-testid="proposal-connector-showcase"
    >
      {items.map((item) => (
        <ProposalItemPreview
          key={`${item.type}:${item.id}`}
          item={item}
          onSelect={onSelect}
          selected={selectedIds?.has(item.id)}
        />
      ))}
    </div>
  )
}

export function ProposalItemList({
  items,
  onSelect,
  selectedIds,
}: {
  items: ProposalItem[]
  onSelect?: (item: ProposalItem) => void
  selectedIds?: Set<string>
}) {
  if (!items.length) return null
  const images = items.filter((item) => item.type === 'image' && (item.imageUrl || item.url))
  const rest = items.filter((item) => !(item.type === 'image' && (item.imageUrl || item.url)))
  // Pure image showcases (e.g. web_search + attach_items) get a photo grid.
  if (images.length > 0 && rest.length === 0 && !onSelect) {
    return <ImageGallery items={images} />
  }
  // Pure connector showcases get a logo grid (GitHub / Slack / …).
  if (rest.length > 0 && rest.every(isConnectorItem) && images.length === 0) {
    return <ConnectorShowcase items={rest} onSelect={onSelect} selectedIds={selectedIds} />
  }
  return (
    <div className="mt-2 space-y-1.5">
      {images.length > 0 && !onSelect ? <ImageGallery items={images} /> : null}
      {(onSelect ? items : rest).map((item) =>
        item.type === 'canvas' ? (
          <CanvasShowcaseCard
            key={`${item.type}:${item.id}`}
            item={item}
            onSelect={onSelect}
            selected={selectedIds?.has(item.id)}
          />
        ) : (
          <ProposalItemPreview
            key={`${item.type}:${item.id}`}
            item={item}
            onSelect={onSelect}
            selected={selectedIds?.has(item.id)}
          />
        ),
      )}
    </div>
  )
}

export default ProposalItemPreview
