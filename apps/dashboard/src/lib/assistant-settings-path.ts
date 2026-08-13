export type AssistantAudience = 'internal' | 'external'
export type AssistantSection = 'customization' | 'agent' | 'installation'

const AUDIENCES: AssistantAudience[] = ['internal', 'external']
const SECTIONS: AssistantSection[] = ['customization', 'agent', 'installation']

/** Default Assistant settings URL (team widget, customization). */
export const ASSISTANT_DEFAULT_PATH = '/ai/assistant/internal/customization' as const

export function assistantSettingsPath(audience: AssistantAudience, section: AssistantSection): string {
  return `/ai/assistant/${audience}/${section}`
}

export function parseAssistantSettingsParams(
  audience: string | undefined,
  section: string | undefined,
): { audience: AssistantAudience; section: AssistantSection } | null {
  if (!audience || !section) return null
  if (!AUDIENCES.includes(audience as AssistantAudience)) return null
  if (!SECTIONS.includes(section as AssistantSection)) return null
  return { audience: audience as AssistantAudience, section: section as AssistantSection }
}
