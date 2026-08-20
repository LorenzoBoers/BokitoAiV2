import { Link } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useWorkspace } from '../../context/WorkspaceContext'

/**
 * Soft 2FA enforcement: shown when the current workspace requires two-factor
 * authentication (Workspace settings) and the signed-in user has not enrolled
 * yet. Links straight to the security section of profile settings.
 */
export default function TwoFactorBanner() {
  const { user } = useAuth()
  const { currentWorkspace } = useWorkspace()

  if (!user || user.totpEnabled) return null
  if (!currentWorkspace?.require_2fa) return null

  return (
    <div className="flex items-center gap-3 border-b border-status-warning/30 bg-status-warning/10 px-4 py-1.5 text-[13px] text-text-primary">
      <ShieldAlert size={14} className="shrink-0 text-status-warning" />
      <span className="min-w-0 truncate">
        This workspace requires two-factor authentication. Set it up to keep your account compliant.
      </span>
      <Link
        to="/settings/profile"
        className="ml-auto shrink-0 rounded-md border border-border/60 px-2.5 py-0.5 font-medium text-text-heading transition-colors hover:bg-bg-hover"
      >
        Set up 2FA
      </Link>
    </div>
  )
}
