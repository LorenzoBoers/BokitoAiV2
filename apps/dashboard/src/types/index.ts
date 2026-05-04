export interface StatCard {
  label: string
  value: string
  change: string
  changeType: 'up' | 'down' | 'neutral'
  icon: string
}

export interface ActivityItem {
  id: string
  user: string
  avatar: string
  action: string
  target: string
  timestamp: string
  type: 'message' | 'agent' | 'system' | 'user'
}

export interface QuickAction {
  id: string
  label: string
  description: string
  icon: string
}

export interface Channel {
  id: string
  name: string
  type: 'channel' | 'dm' | 'thread'
  unread: number
  isActive?: boolean
  icon?: string
}

export interface Member {
  id: string
  name: string
  role: string
  roleColor: string
  avatar: string
  online: boolean
}

export interface Message {
  id: string
  user: string
  avatar: string
  content: string
  timestamp: string
  subject?: string
  preview?: string
  body?: string
  fromEmail?: string
  accountName?: string
  labels?: { name: string; color: 'accent' | 'status-warning' | 'status-error' | 'status-info' }[]
  unread?: boolean
  reactions?: { emoji: string; count: number }[]
  isThread?: boolean
  aiSuggestions?: MailAiSuggestion[]
}

export interface MailAiSuggestionAction {
  id: string
  label: string
}

export interface MailAiSuggestion {
  id: string
  level: 'info' | 'proposal' | 'task'
  text: string
  meta?: string
  actions?: MailAiSuggestionAction[]
}

export interface ChannelInfo {
  name: string
  creator: string
  createdAt: string
  status: string
  statusColor: string
  tags: number
  tasks: number
  linkedThreads: { name: string; category: string }[]
  threadActivity: number[]
  members: Member[]
}

export type CloudAgentStatus = 'active' | 'paused' | 'deploying' | 'error'

export interface CloudAgent {
  id: string
  name: string
  slug: string
  description: string
  model: string
  status: CloudAgentStatus
  region: string
  lastDeployed: string
  requests24h: number
  latencyP50: string
  tools: string[]
  systemPromptPreview: string
  embedUrl: string
}
