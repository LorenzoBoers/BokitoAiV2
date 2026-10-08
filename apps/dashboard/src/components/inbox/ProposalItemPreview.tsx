import type { ComponentType, MouseEvent } from 'react'
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
import { openEntityPath, type EntityRef } from '../../lib/open-entity'
import { toAiAvatarProps } from '../../lib/agent-avatar'
import { cn } from '../../lib/utils'
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
    case 'project':
      return { type: 'project', id: item.id }
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
  return (
    <div className="mt-2 space-y-1.5">
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

export default ProposalItemPreview
