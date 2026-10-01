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
    <div className="flex h-8 items-center gap-2 border-b border-border/60 bg-bg px-3 text-xs text-text-secondary">
      <ShieldAlert size={14} className="shrink-0 text-status-warning" />
      <span className="min-w-0 truncate-fade">
        This workspace requires two-factor authentication. Set it up to keep your account compliant.
      </span>
      <Link
        to="/settings/profile"
        className="ml-auto shrink-0 h-6 rounded-md border border-border/70 px-2 text-xs font-medium text-text-heading transition-colors hover:bg-bg-hover"
      >
        Set up 2FA
      </Link>
    </div>
  )
}
