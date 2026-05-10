import { Outlet, useLocation } from 'react-router-dom';
import { buildControlPlaneUrl, resolveTenantSubdomainFromHost } from '../../lib/host-routing';

export default function ControlPlaneRoute() {
  const location = useLocation();
  const tenantSubdomain = resolveTenantSubdomainFromHost();

  if (!tenantSubdomain) return <Outlet />;

  const targetUrl = buildControlPlaneUrl(`${location.pathname}${location.search}${location.hash}`);
  if (targetUrl && typeof window !== 'undefined') {
    window.location.replace(targetUrl);
    return null;
  }

  return <Outlet />;
}
