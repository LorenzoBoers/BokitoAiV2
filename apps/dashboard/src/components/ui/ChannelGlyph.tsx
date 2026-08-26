import type { LucideIcon } from 'lucide-react'
import { Bot, Hash, Mail, MessageCircle, MessageSquare, MessagesSquare } from 'lucide-react'
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
  widget: MessageSquare,
  slack: Hash,
  whatsapp: MessageCircle,
  internal: MessagesSquare,
  assistant: Bot,
}

type GlyphProps = {
  channel: string
  size?: number
  className?: string
}

export function ChannelGlyph({ channel, size = 13, className }: GlyphProps) {
  const Icon = CHANNEL_ICONS[channelKind(channel)] ?? Mail
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
