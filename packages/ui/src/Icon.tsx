import {
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Mail,
  Mic,
  Paperclip,
  Plus,
  Search,
  Send,
  Sparkles,
  Square,
  StickyNote,
  Ticket,
  User,
  X,
} from 'lucide-react-native'
import type { IconName } from './icons'
import { useTokens } from './theme'

const ICONS = {
  send: Send,
  stop: Square,
  plus: Plus,
  search: Search,
  inbox: Inbox,
  calendar: Calendar,
  user: User,
  sparkles: Sparkles,
  'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  mail: Mail,
  ticket: Ticket,
  note: StickyNote,
  mic: Mic,
  paperclip: Paperclip,
  x: X,
  check: Check,
} as const

export function Icon({
  name,
  size = 18,
  color,
}: {
  name: IconName
  size?: number
  color?: string
}) {
  const tokens = useTokens()
  const Glyph = ICONS[name]
  return <Glyph size={size} color={color ?? tokens.color.textSecondary} />
}
