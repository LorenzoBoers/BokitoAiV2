import { BookOpen, Bot, LayoutDashboard, MessageSquare, Plug, Settings, ShieldCheck } from 'lucide-react'

export const SURFACES = [
  { key: 'communication', to: '/communication', icon: MessageSquare },
  { key: 'overview', to: '/overview', icon: LayoutDashboard },
  { key: 'work', to: '/work', icon: Bot },
  { key: 'knowledge', to: '/knowledge', icon: BookOpen },
  { key: 'connections', to: '/connections', icon: Plug },
  { key: 'govern', to: '/govern', icon: ShieldCheck },
  { key: 'settings', to: '/settings', icon: Settings },
] as const

export type SurfaceKey = (typeof SURFACES)[number]['key']
