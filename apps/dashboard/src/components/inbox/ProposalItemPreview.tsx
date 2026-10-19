import { useEffect, useState, type ComponentType, MouseEvent } from 'react'
import { Skeleton } from '../ui/skeleton'
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
  Route,
  Trash2,
} from 'lucide-react'
import type { ProposalItem } from '../../lib/inbox-api'
import { CANVAS_ICON } from '../../lib/entity-icons'
import { openEntityPath, type EntityRef } from '../../lib/open-entity'
import { getCanvasById } from '../../lib/project-canvas-api'
import { renderCanvasTree } from '../../lib/project-canvas/render'
import { isEmptyCanvasTree, type CanvasNode } from '../../lib/project-canvas/types'
import { agentProfileAccentColor, toAiAvatarProps } from '../../lib/agent-avatar'
import { cn } from '../../lib/utils'
import { BrandTile } from '../integrations/BrandMark'
import { ModuleInstallControls } from '../integrations/ModuleInstallControls'
import { ModulePartnerLogos } from '../integrations/ModuleCard'
import { patchIntegrationModule, type IntegrationModuleRow } from '../../lib/integrations-api'
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
  flow: Route,
  project: FolderKanban,
  folder: FolderKanban,
  canvas: CANVAS_ICON,
  integration: Plug,
  marketplace: Store,
  module: Package,
  help_doc: BookOpen,
  knowledge: BookOpen,
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
    case 'knowledge':
      return { type: 'knowledge', id: item.id }
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
    return (
      <AiAvatar
        {...toAiAvatarProps(
          {
            name: item.title,
            agentId: item.id,
            avatarKind: item.avatarKind,
            avatarIcon: item.avatarIcon,
            avatarColor: item.avatarColor,
            avatarShape: item.avatarShape,
            avatarImageUrl: item.avatarImageUrl ?? item.imageUrl,
          },
          'Agent',
        )}
        size={32}
        decorative
        mode="static"
      />
    )
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
  if (item.type === 'module' && !item.missing) {
    return <ModuleShowcaseCard item={item} onSelect={onSelect} selected={selected} />
  }
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
  const { t } = useTranslation(['communication', 'nav'])
  const pending = Boolean(item.empty || item.missing)
  const [tree, setTree] = useState<CanvasNode | null>(item.preview ?? null)
  const [emptyShell, setEmptyShell] = useState(Boolean(item.empty))
  const [settled, setSettled] = useState(pending || !item.id)
  useEffect(() => {
    if (item.missing || !item.id) return
    let cancel = false
    getCanvasById(item.id)
      .then((canvas) => {
        if (cancel) return
        setEmptyShell(Boolean(canvas.empty || isEmptyCanvasTree(canvas.tree)))
        setTree(canvas.tree)
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
  const preview = !emptyShell && tree && !isEmptyCanvasTree(tree) ? tree : null
  const blocked = pending || emptyShell
  const card = (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-border/60 bg-bg-surface text-left transition-opacity',
        selected && !blocked && 'ring-1 ring-ai/50 border-ai/40',
        blocked && 'opacity-55',
      )}
      data-testid="canvas-showcase"
      data-canvas-pending={blocked ? 'true' : undefined}
      aria-busy={blocked && !item.missing ? true : undefined}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <IconTile icon={CANVAS_ICON} tone={blocked ? 'neutral' : 'accent'} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-text-primary">{item.title || t('proposal.itemType.canvas')}</p>
          {(blocked && !item.missing) || item.subtitle ? (
            <p className="truncate text-xs text-text-muted">
              {blocked && !item.missing
                ? t('projects.canvas.writing', { ns: 'nav' })
                : item.subtitle}
            </p>
          ) : null}
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
        <p className="border-t border-border/50 px-3 py-3 text-xs text-text-muted">
          {blocked && !item.missing
            ? t('projects.canvas.writing', { ns: 'nav' })
            : t('proposal.canvasEmpty')}
        </p>
      ) : (
        <Skeleton className="h-16 rounded-none border-t border-border/50" />
      )}
    </div>
  )
  if (blocked) return card
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

function moduleInstallRow(item: ProposalItem): IntegrationModuleRow {
  const slug = item.slug || item.id
  const state = item.installState || item.kind || 'not_installed'
  const installed = state === 'installed' || state === 'connected' || state === 'on'
  return {
    slug,
    name: item.title,
    description: item.subtitle,
    status: item.moduleStatus === 'coming_soon' ? 'coming_soon' : 'available',
    enabled: installed,
    tenant_status: (item.kind as IntegrationModuleRow['tenant_status']) || 'not_installed',
    install_state:
      state === 'setup' || state === 'installed' || state === 'not_installed' ? state : installed ? 'installed' : 'not_installed',
    setup_path: item.path || `/connections/${slug}`,
    specialist_agent_name: item.name,
    assigned_agent_count: 0,
  } as IntegrationModuleRow
}

/** Same card as the marketplace: specialist, blurb, partner logos, install. */
function ModuleShowcaseCard({
  item,
  onSelect,
  selected,
}: {
  item: ProposalItem
  onSelect?: (item: ProposalItem) => void
  selected?: boolean
}) {
  const { t } = useTranslation(['communication', 'nav'])
  const slug = item.slug || item.id
  const name = t(`integrations.modules.${slug}.name`, { ns: 'nav', defaultValue: item.title })
  const description = t(`integrations.modules.${slug}.description`, {
    ns: 'nav',
    defaultValue: item.subtitle,
  })
  const agentName = t(`integrations.modules.showcase.personas.${slug}.name`, {
    ns: 'nav',
    defaultValue: item.name || name,
  })
  const jobTitle = t(`integrations.modules.showcase.personas.${slug}.title`, {
    ns: 'nav',
    defaultValue: item.jobTitle || '',
  })
  const comingSoon = item.moduleStatus === 'coming_soon' || item.kind === 'coming_soon'
  const color = agentProfileAccentColor(item.avatarColor || '#9159fe')
  const row = moduleInstallRow(item)
  const body = (
    <article
      className={cn(
        'panel relative flex flex-col overflow-hidden p-4 text-left',
        selected && 'ring-1 ring-ai/50',
        onSelect && 'cursor-pointer',
      )}
      data-testid="module-showcase"
    >
      <span
        aria-hidden
        className="specialist-glow pointer-events-none absolute -right-8 -top-10 h-36 w-36 rounded-full blur-2xl"
        style={{ backgroundColor: color }}
      />
      <div className="relative z-[1] flex items-stretch gap-4">
        <div className="flex min-w-0 flex-1 flex-col">
          <h3 className="text-sm font-semibold text-text-heading">{name}</h3>
          <p className="mt-1 line-clamp-3 text-sm leading-snug text-text-secondary">{description}</p>
          {item.roleBlurb ? (
            <p className="mt-2 line-clamp-2 text-xs leading-snug text-text-muted">{item.roleBlurb}</p>
          ) : null}
          {item.toolCount ? (
            <p className="mt-2 text-2xs text-text-muted">
              {t('integrations.modules.showcase.cardTools', {
                ns: 'nav',
                count: item.toolCount,
                defaultValue: '{{count}} agent tools',
              })}
            </p>
          ) : null}
          <div className="mt-auto pt-3">
            <ModulePartnerLogos applications={[]} extraHostSlugs={item.providerSlugs ?? []} />
          </div>
        </div>
        <div className="flex w-max max-w-[42%] shrink-0 flex-col items-center text-center">
          <AiAvatar
            {...toAiAvatarProps({
              id: slug,
              name: agentName,
              avatar_kind: item.avatarKind,
              avatar_icon: item.avatarIcon,
              avatar_color: item.avatarColor,
              avatar_shape: item.avatarShape,
              avatar_image_url: item.avatarImageUrl,
            })}
            size={40}
            mode="live"
            decorative
          />
          <p className="mt-2 max-w-full truncate text-sm font-semibold text-text-heading" title={agentName}>
            {agentName}
          </p>
          {jobTitle ? (
            <p className="max-w-full truncate text-xs font-medium" style={{ color }} title={jobTitle}>
              {jobTitle}
            </p>
          ) : null}
          {comingSoon || onSelect ? null : (
            <div
              className="mt-auto pt-3"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <ModuleInstallControls
                module={row}
                compact
                onAction={(moduleSlug, action) => patchIntegrationModule(moduleSlug, { action })}
              />
            </div>
          )}
        </div>
      </div>
    </article>
  )
  if (onSelect) {
    return (
      <button type="button" className="mt-2 block w-full text-left" onClick={() => onSelect(item)}>
        {body}
      </button>
    )
  }
  return (
    <Link to={item.path || `/connections/${slug}`} className="mt-2 block no-underline">
      {body}
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
