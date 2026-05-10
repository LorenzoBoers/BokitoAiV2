import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useAuth } from './AuthContext';
import type { Workspace, WorkspaceInvite } from '../types/custom-db';
import { xanoGet, xanoPost } from '../lib/xano';
import { XANO_BASE_URL } from '../lib/api.config';
import { resolveTenantSubdomainFromHost } from '../lib/host-routing';

const LAST_WORKSPACE_STORAGE_KEY = 'bokito_current_workspace';

function normalizeAssetUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const path = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return `${XANO_BASE_URL}${encodeURI(path)}`;
}

function normalizeSubdomainCandidate(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

interface WorkspaceContextValue {
  currentWorkspace: Workspace | null;
  workspaces: Workspace[];
  workspaceLoading: boolean;
  invites: WorkspaceInvite[];
  
  createWorkspace: (data: { name: string; timezone: string; logo?: string; subdomain?: string }) => Promise<Workspace>;
  updateWorkspace: (id: number | string, data: Partial<Workspace>) => Promise<void>;
  switchWorkspace: (workspaceId: number | string) => Promise<void>;
  
  inviteUser: (email: string, role: 'admin' | 'member' | 'viewer') => Promise<void>;
  loadInvites: () => Promise<void>;
  
  refreshWorkspaces: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { user, token } = useAuth();
  const [currentWorkspace, setCurrentWorkspace] = useState<Workspace | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [invites, setInvites] = useState<WorkspaceInvite[]>([]);
  const workspaceIdKey = useCallback((id: number | string | null | undefined) => String(id ?? ''), []);

  const normalizeWorkspaceList = useCallback((raw: unknown): Workspace[] => {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => {
        const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : null;
        if (!row) return null;
        const rawId =
          row.id ??
          row.workspace_id ??
          row.workspaceId ??
          row.organisation_id ??
          row.organization_id ??
          row.account_id;
        const parsedId =
          typeof rawId === 'number'
            ? rawId
            : typeof rawId === 'string' && rawId.trim()
              ? rawId.trim()
              : null;
        if (parsedId == null) return null;
        const name =
          typeof row.name === 'string' && row.name.trim()
            ? row.name.trim()
            : typeof row.workspace_name === 'string' && row.workspace_name.trim()
              ? row.workspace_name.trim()
              : null;
        if (!name) return null;
        const livechatSettings =
          row.livechat_settings && typeof row.livechat_settings === 'object'
            ? (row.livechat_settings as Record<string, unknown>)
            : null;
        const logoFromObject =
          livechatSettings?.logo && typeof livechatSettings.logo === 'object'
            ? (livechatSettings.logo as Record<string, unknown>)
            : null;
        const faviconFromObject =
          livechatSettings?.favicon && typeof livechatSettings.favicon === 'object'
            ? (livechatSettings.favicon as Record<string, unknown>)
            : null;
        const resolvedLogo =
          normalizeAssetUrl(row.logo) ??
          normalizeAssetUrl(logoFromObject?.url) ??
          normalizeAssetUrl(logoFromObject?.path);
        const resolvedFavicon =
          normalizeAssetUrl(row.favicon) ??
          normalizeAssetUrl(faviconFromObject?.url) ??
          normalizeAssetUrl(faviconFromObject?.path);
        const resolvedBrandColor =
          typeof row.brand_color === 'string' && row.brand_color.trim()
            ? row.brand_color.trim()
            : typeof livechatSettings?.main_color === 'string' && livechatSettings.main_color.trim()
              ? livechatSettings.main_color.trim()
              : undefined;
        const resolvedSlug =
          typeof row.slug === 'string' && row.slug.trim()
            ? row.slug.trim()
            : typeof livechatSettings?.subdomain === 'string' && livechatSettings.subdomain.trim()
              ? livechatSettings.subdomain.trim()
              : undefined;
        return {
          id: parsedId,
          name,
          slug: resolvedSlug,
          timezone: typeof row.timezone === 'string' && row.timezone.trim() ? row.timezone.trim() : undefined,
          logo: resolvedLogo ?? undefined,
          favicon: resolvedFavicon ?? undefined,
          brand_color: resolvedBrandColor,
        } satisfies Workspace;
      })
      .filter((workspace): workspace is Workspace => workspace !== null);
  }, []);

  const getTenantFallbackWorkspaceList = useCallback((): Workspace[] => {
    const membershipWorkspaces = (user?.memberships ?? [])
      .filter((membership) => membership.status === 'active')
      .map((membership) => ({
        id: membership.tenantId,
        name: membership.name || membership.slug,
        slug: membership.slug,
        role: membership.role === 'user' ? 'member' : membership.role,
      } satisfies Workspace));
    if (membershipWorkspaces.length > 0) return membershipWorkspaces;

    // user.organisationId is the UUID string from /auth/me's organisation_id field.
    // user.tenant.id is always null for UUID-based orgs because toNumber() on a UUID returns null.
    // So we use organisationId as the authoritative source.
    const orgId: string | number | null = user?.organisationId ?? null;
    if (!orgId) return [];
    const tenantName = user?.tenant?.name?.trim();
    if (!tenantName || tenantName.toLowerCase() === 'onbekend') return [];
    return [
      {
        id: orgId,
        name: tenantName,
        slug: user?.tenant?.slug || undefined,
      },
    ];
  }, [user?.memberships, user?.organisationId, user?.tenant?.name, user?.tenant?.slug]);

  const resolvePreferredWorkspace = useCallback(
    (workspaceList: Workspace[]): Workspace | null => {
      if (workspaceList.length === 0) return null;

      const fromUser = (() => {
        // Use organisationId (UUID string) as the primary identifier.
        // user.tenant.id is null for UUID-based orgs because it failed number coercion in AuthContext.
        const preferredId = user?.organisationId ?? null;
        if (preferredId != null) {
          return workspaceList.find((workspace) => workspaceIdKey(workspace.id) === workspaceIdKey(preferredId)) ?? null;
        }
        return null;
      })();

      const fromStorage = (() => {
        try {
          const raw = localStorage.getItem(LAST_WORKSPACE_STORAGE_KEY);
          if (!raw) return null;
          return workspaceList.find((workspace) => workspaceIdKey(workspace.id) === raw) ?? null;
        } catch {
          return null;
        }
      })();

      return fromUser ?? fromStorage ?? workspaceList[0] ?? null;
    },
    [user?.organisationId, workspaceIdKey],
  );

  const refreshWorkspaces = useCallback(async () => {
    if (!token) {
      setWorkspaceLoading(false);
      setWorkspaces([]);
      setCurrentWorkspace(null);
      return;
    }

    setWorkspaceLoading(true);
    try {
      const hostTenantSubdomain = resolveTenantSubdomainFromHost();
      const membershipWorkspaceList = getTenantFallbackWorkspaceList();

      if (hostTenantSubdomain) {
        const tenantWorkspace = membershipWorkspaceList.find(
          (workspace) => normalizeSubdomainCandidate(workspace.slug || '') === hostTenantSubdomain,
        ) ?? null;
        setWorkspaces(tenantWorkspace ? [tenantWorkspace] : []);
        setCurrentWorkspace(tenantWorkspace);
        if (tenantWorkspace) {
          try {
            localStorage.setItem(LAST_WORKSPACE_STORAGE_KEY, workspaceIdKey(tenantWorkspace.id));
          } catch {
            // Ignore storage failures.
          }
        }
        return;
      }

      if (membershipWorkspaceList.length > 0) {
        setWorkspaces(membershipWorkspaceList);
        const preferredWorkspace = resolvePreferredWorkspace(membershipWorkspaceList);
        setCurrentWorkspace(preferredWorkspace);
        if (preferredWorkspace) {
          try {
            localStorage.setItem(LAST_WORKSPACE_STORAGE_KEY, workspaceIdKey(preferredWorkspace.id));
          } catch {
            // Ignore storage failures.
          }
        }
        return;
      }

      const workspaceList = await xanoGet<unknown>('/workspaces', token);
      const safeWorkspaceList = normalizeWorkspaceList(workspaceList);
      const resolvedWorkspaceList = safeWorkspaceList.length > 0 ? safeWorkspaceList : getTenantFallbackWorkspaceList();
      if (safeWorkspaceList.length === 0 && resolvedWorkspaceList.length > 0) {
        console.info('WorkspaceContext: using tenant fallback workspace from auth context');
      }
      const hostLockedWorkspace = hostTenantSubdomain
        ? resolvedWorkspaceList.find((workspace) => normalizeSubdomainCandidate(workspace.slug || '') === hostTenantSubdomain) ?? null
        : null;

      const effectiveWorkspaceList = hostTenantSubdomain
        ? (hostLockedWorkspace ? [hostLockedWorkspace] : [])
        : resolvedWorkspaceList;

      setWorkspaces(effectiveWorkspaceList);

      const preferredWorkspace = hostTenantSubdomain
        ? hostLockedWorkspace
        : resolvePreferredWorkspace(effectiveWorkspaceList);
      setCurrentWorkspace(preferredWorkspace);
      if (preferredWorkspace) {
        try {
          localStorage.setItem(LAST_WORKSPACE_STORAGE_KEY, workspaceIdKey(preferredWorkspace.id));
        } catch {
          // Ignore storage failures.
        }
      }
    } catch (error) {
      console.error('Failed to load workspaces:', error);
      const fallbackWorkspaceList = getTenantFallbackWorkspaceList();
      setWorkspaces(fallbackWorkspaceList);
      setCurrentWorkspace(resolvePreferredWorkspace(fallbackWorkspaceList));
    } finally {
      setWorkspaceLoading(false);
    }
  }, [getTenantFallbackWorkspaceList, normalizeWorkspaceList, resolvePreferredWorkspace, token]);

  useEffect(() => {
    void refreshWorkspaces();
  }, [refreshWorkspaces]);

  const createWorkspace = useCallback(async (data: { name: string; timezone: string; logo?: string; subdomain?: string }) => {
    if (!token) throw new Error('Not authenticated');

    const fallbackSubdomain = normalizeSubdomainCandidate(data.name || 'workspace');
    const normalizedSubdomain = normalizeSubdomainCandidate(data.subdomain || fallbackSubdomain).slice(0, 63);
    const workspace = await xanoPost<Workspace>('/workspaces', { ...data, subdomain: normalizedSubdomain }, token);
    setWorkspaces(prev => [...prev, workspace]);
    setCurrentWorkspace(workspace);
    try {
      localStorage.setItem(LAST_WORKSPACE_STORAGE_KEY, String(workspace.id));
    } catch {
      // Ignore storage failures.
    }
    return workspace;
  }, [token]);

  const updateWorkspace = useCallback(async (id: number | string, data: Partial<Workspace>) => {
    if (!token) throw new Error('Not authenticated');
    
    const updated = await xanoPost<Workspace>(`/workspaces/${id}`, data, token);
    setWorkspaces(prev => prev.map(w => (workspaceIdKey(w.id) === workspaceIdKey(id) ? { ...w, ...updated } : w)));
    if (workspaceIdKey(currentWorkspace?.id) === workspaceIdKey(id)) {
      setCurrentWorkspace(prev => prev ? { ...prev, ...updated } : null);
    }
  }, [token, currentWorkspace?.id, workspaceIdKey]);

  const switchWorkspace = useCallback(async (workspaceId: number | string) => {
    const hostTenantSubdomain = resolveTenantSubdomainFromHost();
    if (hostTenantSubdomain) {
      const hostLockedWorkspace = workspaces.find(
        (workspace) => normalizeSubdomainCandidate(workspace.slug || '') === hostTenantSubdomain,
      );
      if (hostLockedWorkspace) {
        setCurrentWorkspace(hostLockedWorkspace);
        localStorage.setItem(LAST_WORKSPACE_STORAGE_KEY, workspaceIdKey(hostLockedWorkspace.id));
      }
      return;
    }

    const workspace = workspaces.find(w => workspaceIdKey(w.id) === workspaceIdKey(workspaceId));
    if (workspace) {
      setCurrentWorkspace(workspace);
      // Store preference in localStorage
      localStorage.setItem(LAST_WORKSPACE_STORAGE_KEY, workspaceIdKey(workspaceId));
    }
  }, [workspaces, workspaceIdKey]);

  const inviteUser = useCallback(async (email: string, role: 'admin' | 'member' | 'viewer') => {
    if (!token || !currentWorkspace) throw new Error('Not authenticated or no workspace');
    
    await xanoPost('/workspace-invites', {
      workspace_id: currentWorkspace.id,
      email,
      role,
    }, token);
    
    // Refresh invites
    await loadInvites();
  }, [token, currentWorkspace]);

  const loadInvites = useCallback(async () => {
    if (!token || !currentWorkspace) return;
    
    try {
      const inviteList = await xanoGet<WorkspaceInvite[]>(`/workspaces/${currentWorkspace.id}/invites`, token);
      setInvites(Array.isArray(inviteList) ? inviteList : []);
    } catch (error) {
      console.error('Failed to load invites:', error);
      setInvites([]);
    }
  }, [token, currentWorkspace]);

  const value: WorkspaceContextValue = {
    currentWorkspace,
    workspaces,
    workspaceLoading,
    invites,
    createWorkspace,
    updateWorkspace,
    switchWorkspace,
    inviteUser,
    loadInvites,
    refreshWorkspaces,
  };

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }
  return context;
}