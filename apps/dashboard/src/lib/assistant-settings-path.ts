export type AssistantAudience = 'internal' | 'external'
export type AssistantSection = 'customization' | 'hours' | 'installation'

const AUDIENCES: AssistantAudience[] = ['internal', 'external']
const SECTIONS: AssistantSection[] = ['customization', 'hours', 'installation']

/** Website widget look — used when a settings URL is invalid. */
export const ASSISTANT_DEFAULT_PATH = '/ai/assistant/external/customization' as const

/** Website chat — first place first-time users look for the customer widget. */
export const WEBSITE_WIDGET_PATH = '/ai/assistant/external/installation' as const

/** Website chat look-and-feel (welcome, colors, icon). */
export const WEBSITE_WIDGET_CUSTOMIZE_PATH = '/ai/assistant/external/customization' as const

/** Website chat voice and team reachability hours. */
export const WEBSITE_WIDGET_HOURS_PATH = '/ai/assistant/external/hours' as const

/** Personal Bokito helper (memory), not the website widget. */
export const MY_ASSISTANT_SETTINGS_PATH = '/settings/assistant' as const

export function assistantSettingsPath(
  _audience: AssistantAudience,
  section: AssistantSection,
): string {
  return `/ai/assistant/external/${section}`
}

export function parseAssistantSettingsParams(
  audience: string | undefined,
  section: string | undefined,
): { audience: AssistantAudience; section: AssistantSection } | null {
  if (!audience || !section) return null
  const normalizedSection = section === 'agent' ? 'hours' : section
  if (!AUDIENCES.includes(audience as AssistantAudience)) return null
  if (!SECTIONS.includes(normalizedSection as AssistantSection)) return null
  return { audience: audience as AssistantAudience, section: normalizedSection as AssistantSection }
}

/** Canonical URL when the request used a legacy audience or `agent` section. */
export function assistantSettingsCanonicalPath(
  audience: string | undefined,
  section: string | undefined,
): string {
  const parsed = parseAssistantSettingsParams(audience, section)
  if (!parsed) return ASSISTANT_DEFAULT_PATH
  return assistantSettingsPath('external', parsed.section)
}
