import type { LucideIcon } from 'lucide-react'
import { Bot, Globe, Hash, Mail, MessageCircle, MessageCircleMore, MessagesSquare } from 'lucide-react'
import { useIntegrationBrand } from '../../context/IntegrationBrandContext'
import { cn } from '../../lib/utils'

const CHANNEL_ALIASES: Record<string, string> = {
  customer_widget: 'widget',
  webchat: 'widget',
  chat: 'widget',
  livechat: 'widget',
}

export function channelKind(channel: string): string {
  const key = channel.trim().toLowerCase()
  return CHANNEL_ALIASES[key] ?? key
}

const CHANNEL_ICONS: Record<string, LucideIcon> = {
  email: Mail,
  widget: MessageCircleMore,
  slack: Hash,
  whatsapp: MessageCircle,
  api: Globe,
  webhook: Globe,
  integration: Globe,
  internal: MessagesSquare,
  assistant: Bot,
  webchat: MessageCircleMore,
}

// Only true third-party brands get a logo image; email and website chat use
// the crisp SVG icons above so they stay legible at small sizes.
const CHANNEL_BRAND: Record<string, string> = {
  slack: 'slack',
  whatsapp: 'whatsapp',
}

type GlyphProps = {
  channel: string
  size?: number
  className?: string
}

function BrandOrIcon({
  slug,
  kind,
  size,
  className,
}: {
  slug: string
  kind: string
  size: number
  className?: string
}) {
  const brand = useIntegrationBrand(slug)
  if (brand.logoUrl) {
    return (
      <img
        src={brand.logoUrl}
        alt=""
        title={brand.name}
        style={{ width: size, height: size }}
        className={cn('shrink-0 object-contain', className)}
        loading="lazy"
      />
    )
  }
  const Icon = CHANNEL_ICONS[kind] ?? Mail
  return <Icon size={size} className={cn('shrink-0 text-text-muted', className)} />
}

export function ChannelGlyph({ channel, size = 13, className }: GlyphProps) {
  const kind = channelKind(channel)
  const slug = CHANNEL_BRAND[kind]
  if (slug) {
    return <BrandOrIcon slug={slug} kind={kind} size={size} className={className} />
  }
  const Icon = CHANNEL_ICONS[kind] ?? Mail
  return <Icon size={size} className={cn('shrink-0 text-text-muted', className)} />
}

type LabelProps = {
  channel: string
  label: string
  size?: number
  className?: string
}

export function ChannelLabel({ channel, label, size = 13, className }: LabelProps) {
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <ChannelGlyph channel={channel} size={size} />
      <span>{label}</span>
    </span>
  )
}
