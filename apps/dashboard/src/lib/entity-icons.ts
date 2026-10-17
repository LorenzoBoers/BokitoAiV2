/**
 * Canonical Lucide marks for first-class entities. Import these instead of
 * picking a one-off icon so Bin chips, tabs, chat links, folder cards and
 * showcase cards stay recognizable: one object, one mark, everywhere.
 */
import {
  Bot,
  Brain,
  Building2,
  CalendarClock,
  FolderOpen,
  LayoutTemplate,
  ListFilter,
  MessageSquare,
  MessageSquareText,
  Route,
  ScrollText,
  UserRound,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react'

/** Snapshot canvas (workspace or project) — never LayoutDashboard (Overview). */
export const CANVAS_ICON: LucideIcon = LayoutTemplate

/** Entity kinds with a shared mark. Mirrors the Bin types plus live-only kinds. */
export type EntityIconKind =
  | 'conversation'
  | 'folder'
  | 'project'
  | 'canvas'
  | 'knowledge'
  | 'contact'
  | 'company'
  | 'flow'
  | 'agent'
  | 'trigger'
  | 'agenda'
  | 'team'
  | 'decision'
  | 'inbox_rule'
  | 'saved_reply'

export const ENTITY_ICONS: Record<EntityIconKind, LucideIcon> = {
  conversation: MessageSquare,
  folder: FolderOpen,
  project: FolderOpen,
  canvas: CANVAS_ICON,
  knowledge: Brain,
  contact: UserRound,
  company: Building2,
  flow: Route,
  agent: Bot,
  trigger: Zap,
  agenda: CalendarClock,
  team: Users,
  decision: ScrollText,
  inbox_rule: ListFilter,
  saved_reply: MessageSquareText,
}

/** Bin rows and audit payloads use older names for a few kinds. */
const ENTITY_KIND_ALIASES: Record<string, EntityIconKind> = {
  signal: 'conversation',
  thread: 'conversation',
  project: 'folder',
  playbook: 'flow',
  workstream: 'flow',
  doc: 'knowledge',
  workspace_doc: 'knowledge',
  organization: 'company',
}

/** The mark for a kind, or `fallback` for kinds without one. */
export function entityIcon(kind: string | null | undefined, fallback: LucideIcon): LucideIcon {
  if (!kind) return fallback
  const key = (ENTITY_KIND_ALIASES[kind] ?? kind) as EntityIconKind
  return ENTITY_ICONS[key] ?? fallback
}
