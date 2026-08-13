import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { buildAppLoginUrl, resolveTenantSubdomainFromHost } from '../../lib/host-routing';

export default function ProtectedRoute() {
  const { user, isLoading, hasTenantAccess } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
      </div>
    );
  }

  const returnUrl = `${location.pathname}${location.search}${location.hash}`;
  if (user) {
    const tenantSubdomain = resolveTenantSubdomainFromHost();
    if (tenantSubdomain && !hasTenantAccess(tenantSubdomain)) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-bg px-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-bg-surface p-6 text-center shadow-xl">
            <p className="text-sm text-status-error">You do not have access to this workspace.</p>
          </div>
        </div>
      );
    }
    return <Outlet />;
  }

  const appLoginUrl = typeof window !== 'undefined' ? buildAppLoginUrl(window.location.href) : null;
  if (appLoginUrl && typeof window !== 'undefined') {
    window.location.replace(appLoginUrl);
    return null;
  }

  return <Navigate to={`/login?return_to=${encodeURIComponent(returnUrl)}`} replace />;
}
