export const LAST_LOGIN_EMAIL_KEY = 'bokito.lastLoginEmail'

export function readLastLoginEmail(): string {
  try {
    return (globalThis.localStorage.getItem(LAST_LOGIN_EMAIL_KEY) ?? '').trim()
  } catch {
    return ''
  }
}

export function writeLastLoginEmail(email: string): void {
  const next = email.trim()
  try {
    if (!next) globalThis.localStorage.removeItem(LAST_LOGIN_EMAIL_KEY)
    else globalThis.localStorage.setItem(LAST_LOGIN_EMAIL_KEY, next)
  } catch {
    // Private mode — login still works.
  }
}
