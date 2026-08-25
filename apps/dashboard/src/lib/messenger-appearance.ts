/**
 * Tenant messenger / widget appearance (v1: opmaak).
 * Stored under organisation.livechat_settings.appearance (JSON object).
 * Widget preview uses the same keys in data-preview-overrides JSON.
 */

import { DEFAULT_BRAND_COLOR } from './tenant-branding'

// Mirrors the widget's real tabs (Home / Messages / Help / Tools). The Help
// tab additionally requires published help-center articles to appear.
export type MessengerModuleKey = 'home' | 'messages' | 'help' | 'tools'

export const MESSENGER_MODULE_KEYS: MessengerModuleKey[] = ['home', 'messages', 'help', 'tools']

export const MESSENGER_MODULE_LABELS: Record<MessengerModuleKey, string> = {
  home: 'Home',
  messages: 'Messages',
  help: 'Help',
  tools: 'Tools',
}

export const DEFAULT_MESSENGER_MODULES: Record<MessengerModuleKey, boolean> = {
  home: true,
  messages: true,
  help: true,
  tools: true,
}

export interface MessengerAppearance {
  main_color: string
  welcome_title: string
  welcome_subtitle: string
  chatbot_name: string
  /** Resolved public URL for widget header favicon; null when unset */
  widget_favicon_url: string | null
  /** Which messenger modules are surfaced in the widget. */
  modules: Record<MessengerModuleKey, boolean>
}

export const DEFAULT_MESSENGER_APPEARANCE: MessengerAppearance = {
  main_color: DEFAULT_BRAND_COLOR,
  welcome_title: '',
  welcome_subtitle: '',
  chatbot_name: '',
  widget_favicon_url: null,
  modules: { ...DEFAULT_MESSENGER_MODULES },
}

function normalizeModules(raw: unknown): Record<MessengerModuleKey, boolean> {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const result = { ...DEFAULT_MESSENGER_MODULES }
  for (const key of MESSENGER_MODULE_KEYS) {
    if (typeof source[key] === 'boolean') result[key] = source[key] as boolean
  }
  return result
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function pickWidgetFaviconUrl(
  appearance: Record<string, unknown>,
  normalizeUrl: (v: unknown) => string | null,
): string | null {
  const w = appearance.widget_favicon
  if (w && typeof w === 'object') {
    const o = w as Record<string, unknown>
    return normalizeUrl(o.url) ?? normalizeUrl(o.path)
  }
  return normalizeUrl(appearance.widget_favicon_url)
}

/**
 * Merge API `livechat_settings.appearance` (or legacy flat keys) into MessengerAppearance.
 */
export function normalizeMessengerAppearance(
  livechatSettings: Record<string, unknown> | null | undefined,
  opts?: {
    brandColorFallback?: string
    normalizeAssetUrl?: (v: unknown) => string | null
  },
): MessengerAppearance {
  const normalizeUrl =
    opts?.normalizeAssetUrl ??
    ((v: unknown) => {
      if (typeof v !== 'string') return null
      const t = v.trim()
      return t || null
    })
  const ls = livechatSettings && typeof livechatSettings === 'object' ? livechatSettings : {}
  const rawAppearance = ls.appearance && typeof ls.appearance === 'object' ? (ls.appearance as Record<string, unknown>) : {}

  const mainFromAppearance = str(rawAppearance.main_color)
  const mainFlat = str(ls.main_color)
  const brand = str(opts?.brandColorFallback)

  const welcomeTitle = str(rawAppearance.welcome_title)
  const welcomeSub = str(rawAppearance.welcome_subtitle)
  const chatbotName = str(rawAppearance.chatbot_name)
  const fav = pickWidgetFaviconUrl(rawAppearance, normalizeUrl)

  const main_color = mainFromAppearance || mainFlat || brand || DEFAULT_MESSENGER_APPEARANCE.main_color

  return {
    main_color,
    welcome_title: welcomeTitle,
    welcome_subtitle: welcomeSub,
    chatbot_name: chatbotName,
    widget_favicon_url: fav,
    modules: normalizeModules(rawAppearance.modules),
  }
}

/** JSON payload for bokito-chat data-preview-overrides (subset of theme + extras). */
export function serializeAppearanceForWidgetPreview(a: MessengerAppearance): Record<string, unknown> {
  const main = a.main_color.trim() || DEFAULT_MESSENGER_APPEARANCE.main_color
  return {
    main_color: main,
    primary_color: main,
    chatbot_name: a.chatbot_name,
    welcome_title: a.welcome_title,
    welcome_subtitle: a.welcome_subtitle,
    widget_favicon_url: a.widget_favicon_url || '',
    modules: { ...a.modules },
  }
}

export function messengerAppearanceEquals(a: MessengerAppearance, b: MessengerAppearance): boolean {
  return (
    a.main_color === b.main_color &&
    a.welcome_title === b.welcome_title &&
    a.welcome_subtitle === b.welcome_subtitle &&
    a.chatbot_name === b.chatbot_name &&
    a.widget_favicon_url === b.widget_favicon_url &&
    MESSENGER_MODULE_KEYS.every((key) => a.modules[key] === b.modules[key])
  )
}

/** Shape sent with workspace branding save (JSON field). */
export function appearanceToBrandingJson(a: MessengerAppearance): Record<string, unknown> {
  return {
    main_color: a.main_color.trim() || DEFAULT_MESSENGER_APPEARANCE.main_color,
    welcome_title: a.welcome_title.trim(),
    welcome_subtitle: a.welcome_subtitle.trim(),
    chatbot_name: a.chatbot_name.trim(),
    modules: { ...a.modules },
  }
}
