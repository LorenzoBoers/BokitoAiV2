import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useAuth } from './AuthContext';
import type { Workspace, WorkspaceInvite } from '../types/custom-db';
import { xanoGet, xanoPost } from '../lib/xano';

interface WorkspaceContextValue {
  currentWorkspace: Workspace | null;
  workspaces: Workspace[];
  workspaceLoading: boolean;
  invites: WorkspaceInvite[];
  
  createWorkspace: (data: { name: string; timezone: string; logo?: string }) => Promise<Workspace>;
  updateWorkspace: (id: number, data: Partial<Workspace>) => Promise<void>;
  switchWorkspace: (workspaceId: number) => Promise<void>;
  
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

  const refreshWorkspaces = useCallback(async () => {
    if (!token) {
      setWorkspaceLoading(false);
      return;
    }

    setWorkspaceLoading(true);
    try {
      const workspaceList = await xanoGet<Workspace[]>('/workspaces', token);
      setWorkspaces(Array.isArray(workspaceList) ? workspaceList : []);
      
      // Set current workspace from user workspace info or first workspace
      if (workspaceList.length > 0) {
        const current = user?.workspace.id 
          ? workspaceList.find(w => w.id === user.workspace.id) || workspaceList[0]
          : workspaceList[0];
        setCurrentWorkspace(current);
      }
    } catch (error) {
      console.error('Failed to load workspaces:', error);
      setWorkspaces([]);
      setCurrentWorkspace(null);
    } finally {
      setWorkspaceLoading(false);
    }
  }, [token, user?.workspace.id]);

  useEffect(() => {
    void refreshWorkspaces();
  }, [refreshWorkspaces]);

  const createWorkspace = useCallback(async (data: { name: string; timezone: string; logo?: string }) => {
    if (!token) throw new Error('Not authenticated');
    
    const workspace = await xanoPost<Workspace>('/workspaces', data, token);
    setWorkspaces(prev => [...prev, workspace]);
    setCurrentWorkspace(workspace);
    return workspace;
  }, [token]);

  const updateWorkspace = useCallback(async (id: number, data: Partial<Workspace>) => {
    if (!token) throw new Error('Not authenticated');
    
    const updated = await xanoPost<Workspace>(`/workspaces/${id}`, data, token);
    setWorkspaces(prev => prev.map(w => w.id === id ? { ...w, ...updated } : w));
    if (currentWorkspace?.id === id) {
      setCurrentWorkspace(prev => prev ? { ...prev, ...updated } : null);
    }
  }, [token, currentWorkspace?.id]);

  const switchWorkspace = useCallback(async (workspaceId: number) => {
    const workspace = workspaces.find(w => w.id === workspaceId);
    if (workspace) {
      setCurrentWorkspace(workspace);
      // Store preference in localStorage
      localStorage.setItem('bokito_current_workspace', workspaceId.toString());
    }
  }, [workspaces]);

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