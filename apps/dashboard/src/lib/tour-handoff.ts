/** Handoff from the first-run wizard to the rail tour (session-scoped). */

const KEY = 'bokito-start-tour-after-wizard'

export function markTourPendingAfterWizard(): void {
  try {
    sessionStorage.setItem(KEY, '1')
  } catch {
    // ignore
  }
}

export function consumeTourPendingAfterWizard(): boolean {
  try {
    if (sessionStorage.getItem(KEY) !== '1') return false
    sessionStorage.removeItem(KEY)
    return true
  } catch {
    return false
  }
}
