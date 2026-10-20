import rows from './legacy-redirects.json'

export type LegacyRedirect = {
  from: string
  to: string
  preserveSearch?: boolean
}

/** Static legacy URLs. Parametric redirects stay as route components in App.tsx. */
export const LEGACY_REDIRECTS: LegacyRedirect[] = rows

export function redirectPathname(to: string): string {
  return to.split('#')[0].split('?')[0]
}
