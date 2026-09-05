import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { getOnboardingWizard } from '../../lib/onboarding-wizard-api'

/**
 * Redirect owners (and invited members who still need personal prefs) into
 * `/onboarding` until the first-run wizard is finished. Allows logout only
 * via the wizard itself; other app routes bounce here.
 */
export function OnboardingWizardGate({ children }: { children: React.ReactNode }) {
  const { token, currentTenantRole } = useAuth()
  const location = useLocation()
  const [needed, setNeeded] = useState<boolean | null>(null)

  const onWizardRoute = location.pathname === '/onboarding' || location.pathname.startsWith('/onboarding/')

  useEffect(() => {
    if (!token || onWizardRoute) {
      setNeeded(false)
      return
    }
    let cancelled = false
    void getOnboardingWizard(token)
      .then((state) => {
        if (cancelled) return
        const ownerNeeds =
          (currentTenantRole === 'owner' || currentTenantRole === 'admin') && state.needs_wizard
        const memberNeeds =
          currentTenantRole === 'member' && state.needs_personal_wizard
        setNeeded(ownerNeeds || memberNeeds)
      })
      .catch(() => {
        if (!cancelled) setNeeded(false)
      })
    return () => {
      cancelled = true
    }
  }, [token, currentTenantRole, onWizardRoute, location.pathname])

  if (onWizardRoute) return <>{children}</>
  if (needed === null) {
    return (
      <div className="flex min-h-screen items-center justify-center text-text-muted">
        <span className="text-sm">…</span>
      </div>
    )
  }
  if (needed) return <Navigate to="/onboarding" replace />
  return <>{children}</>
}
