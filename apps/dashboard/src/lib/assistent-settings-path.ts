export type AssistentAudience = 'internal' | 'external'
export type AssistentSection = 'customization' | 'agent' | 'installation'

const AUDIENCES: AssistentAudience[] = ['internal', 'external']
const SECTIONS: AssistentSection[] = ['customization', 'agent', 'installation']

/** Default Assistent settings URL (team widget, customization). */
export const ASSISTENT_DEFAULT_PATH = '/ai/assistent/internal/customization' as const

export function assistentSettingsPath(audience: AssistentAudience, section: AssistentSection): string {
  return `/ai/assistent/${audience}/${section}`
}

export function parseAssistentSettingsParams(
  audience: string | undefined,
  section: string | undefined,
): { audience: AssistentAudience; section: AssistentSection } | null {
  if (!audience || !section) return null
  if (!AUDIENCES.includes(audience as AssistentAudience)) return null
  if (!SECTIONS.includes(section as AssistentSection)) return null
  return { audience: audience as AssistentAudience, section: section as AssistentSection }
}
