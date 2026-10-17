import {
  Bot,
  Briefcase,
  Bug,
  Calendar,
  Clock,
  CreditCard,
  Download,
  FileText,
  Flag,
  FlaskConical,
  GitBranch,
  Headset,
  Heart,
  LifeBuoy,
  MapPin,
  Megaphone,
  MessageCircle,
  Package,
  PenLine,
  Phone,
  PhoneCall,
  Plug,
  Receipt,
  Route,
  RefreshCw,
  Shield,
  Siren,
  Sparkles,
  Star,
  Tag,
  Truck,
  User,
  UserPlus,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react'

/** Flow-label hues. Ids match the API allowlist. */
export const LABEL_MARK_COLORS = ['rose', 'teal', 'violet', 'orange', 'emerald', 'pink', 'sky'] as const

export type LabelMarkColor = (typeof LABEL_MARK_COLORS)[number]

export const LABEL_MARK_INK: Record<LabelMarkColor, { ink: string; wash: string }> = {
  rose: { ink: '#fb7185', wash: 'rgba(251, 113, 133, 0.16)' },
  teal: { ink: '#2dd4bf', wash: 'rgba(45, 212, 191, 0.16)' },
  violet: { ink: '#a78bfa', wash: 'rgba(167, 139, 250, 0.16)' },
  orange: { ink: '#fb923c', wash: 'rgba(251, 146, 60, 0.16)' },
  emerald: { ink: '#34d399', wash: 'rgba(52, 211, 153, 0.16)' },
  pink: { ink: '#f472b6', wash: 'rgba(244, 114, 182, 0.16)' },
  sky: { ink: '#38bdf8', wash: 'rgba(56, 189, 248, 0.16)' },
}

/** Lucide kebab ids the API accepts. */
export const LABEL_MARK_ICONS: Record<string, LucideIcon> = {
  bug: Bug,
  shield: Shield,
  'flask-conical': FlaskConical,
  'git-branch': GitBranch,
  route: Route,
  siren: Siren,
  'life-buoy': LifeBuoy,
  headset: Headset,
  'message-circle': MessageCircle,
  phone: Phone,
  'user-plus': UserPlus,
  calendar: Calendar,
  'map-pin': MapPin,
  wrench: Wrench,
  package: Package,
  truck: Truck,
  'file-text': FileText,
  receipt: Receipt,
  'credit-card': CreditCard,
  user: User,
  bot: Bot,
  'refresh-cw': RefreshCw,
  plug: Plug,
  download: Download,
  zap: Zap,
  sparkles: Sparkles,
  'phone-call': PhoneCall,
  star: Star,
  clock: Clock,
  megaphone: Megaphone,
  'pen-line': PenLine,
  briefcase: Briefcase,
  heart: Heart,
  flag: Flag,
  tag: Tag,
}

/** New flow labels start blue with the route mark. Ids match the API defaults. */
export const FLOW_LABEL_COLOR: LabelMarkColor = 'sky'
export const FLOW_LABEL_ICON = 'route'

export function labelMarkIcon(name: string | null | undefined): LucideIcon | null {
  if (!name) return null
  return LABEL_MARK_ICONS[name] ?? null
}

export function labelMarkInk(color: string | null | undefined): { ink: string; wash: string } | null {
  if (!color || !(color in LABEL_MARK_INK)) return null
  return LABEL_MARK_INK[color as LabelMarkColor]
}
