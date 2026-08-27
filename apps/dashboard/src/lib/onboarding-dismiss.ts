export function onboardingDismissKey(tenantId: string | null): string {
  return `bokito-onboarding-dismissed:${tenantId ?? 'default'}`
}

export function readOnboardingDismissed(tenantId: string | null): boolean {
  try {
    return globalThis.localStorage.getItem(onboardingDismissKey(tenantId)) === '1'
  } catch {
    return false
  }
}

export function writeOnboardingDismissed(tenantId: string | null, dismissed: boolean): void {
  try {
    const key = onboardingDismissKey(tenantId)
    if (dismissed) globalThis.localStorage.setItem(key, '1')
    else globalThis.localStorage.removeItem(key)
  } catch {
    // ignore storage failures
  }
}
