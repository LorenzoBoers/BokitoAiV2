import { Bot, Globe, Mail, MessageCircle, MessagesSquare, Phone, Webhook } from 'lucide-react'

import type { Channel } from '@/api/types'
import { cn } from '@/lib/cn'

const ICONS = {
  email: Mail,
  whatsapp: MessageCircle,
  widget: Globe,
  phone: Phone,
  slack: MessagesSquare,
  internal: Bot,
  api: Webhook,
} as const

export function ChannelIcon({ channel, className }: { channel: Channel; className?: string }) {
  const Icon = ICONS[channel] ?? MessagesSquare
  return <Icon className={cn('h-3.5 w-3.5', className)} aria-label={channel} />
}
