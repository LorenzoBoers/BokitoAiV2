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

export const CHANNEL_LABELS: Record<string, { en: string; nl: string }> = {
  email: { en: 'Email', nl: 'E-mail' },
  widget: { en: 'Website chat', nl: 'Websitechat' },
  slack: { en: 'Slack', nl: 'Slack' },
  whatsapp: { en: 'WhatsApp', nl: 'WhatsApp' },
  internal: { en: 'Team', nl: 'Team' },
  assistant: { en: 'Assistant', nl: 'Assistent' },
}

export function channelLabel(channel: string, locale: 'en' | 'nl' = 'en'): string {
  const kind = channelKind(channel)
  return CHANNEL_LABELS[kind]?.[locale] ?? kind
}

export type ChannelIconName =
  | 'mail-outline'
  | 'chatbubble-outline'
  | 'logo-slack'
  | 'logo-whatsapp'
  | 'people-outline'
  | 'sparkles-outline'
  | 'help-circle-outline'

export function isCustomerChannel(channel: string): boolean {
  return ['email', 'widget', 'whatsapp', 'slack'].includes(channelKind(channel))
}

export function channelIcon(channel: string): ChannelIconName {
  switch (channelKind(channel)) {
    case 'email':
      return 'mail-outline'
    case 'widget':
      return 'chatbubble-outline'
    case 'slack':
      return 'logo-slack'
    case 'whatsapp':
      return 'logo-whatsapp'
    case 'internal':
      return 'people-outline'
    case 'assistant':
      return 'sparkles-outline'
    default:
      return 'help-circle-outline'
  }
}
