import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/layout/Layout'
import DatabaseLayout from './components/layout/DatabaseLayout'
import WorkspaceHubLayout from './components/layout/WorkspaceHubLayout'
import ProtectedRoute from './components/auth/ProtectedRoute'
import ControlPlaneRoute from './components/auth/ControlPlaneRoute'
import { useWorkspace } from './context/WorkspaceContext'
import { resolveTenantSubdomainFromHost } from './lib/host-routing'
import { listProjects } from './lib/projects-api'
import Login from './pages/Login'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import Onboarding from './pages/Onboarding'
import Communication from './pages/Communication'
import InboxSettings from './pages/InboxSettings'
import DatabasePage, { DatabasePageWithProvider } from './pages/DatabasePage'
import ProfileSettings from './pages/ProfileSettings'
import NotificationSettings from './pages/NotificationSettings'
import CompanyConfig from './pages/CompanyConfig'
import MemberManagement from './pages/MemberManagement'
import MessengerSettings from './pages/MessengerSettings'
import { ASSISTENT_DEFAULT_PATH } from './lib/assistent-settings-path'
import HelpCentersSettings from './pages/HelpCentersSettings'
import CloudAgent from './pages/CloudAgent'
import Projects from './pages/Projects'
import CreateProject from './pages/CreateProject'
import ProjectDoc from './pages/ProjectDoc'
import ProjectLayout from './components/layout/ProjectLayout'
import ProjectOverview from './pages/ProjectOverview'
import ProjectSettings from './pages/ProjectSettings'
import ProjectMessages from './pages/ProjectMessages'
import ConnectProjectRepo from './pages/ConnectProjectRepo'
import ChangeRequest from './pages/ChangeRequest'
import AdminRuns from './pages/AdminRuns'
import DataSources from './pages/DataSources'
import AiCommunicationSettings from './pages/AiCommunicationSettings'
import WorkforceControl from './pages/OrchestratorControl'
import WorkspaceSettings from './pages/WorkspaceSettings'
import Workspaces from './pages/Workspaces'
import WorkspaceBilling from './pages/WorkspaceBilling'
import WorkspaceAccount from './pages/WorkspaceAccount'
import WorkspaceSupport from './pages/WorkspaceSupport'
import IntegrationsLayout from './components/layout/IntegrationsLayout'
import IntegrationsMarketplace from './pages/IntegrationsMarketplace'
import IntegrationsConnected from './pages/IntegrationsConnected'
import IntegrationsMcp from './pages/IntegrationsMcp'
import IntegrationsApi from './pages/IntegrationsApi'

type ProjectRedirect =
  | { state: 'loading' }
  | { state: 'none' }
  | { state: 'one'; id: string }
  | { state: 'many' }
  | { state: 'error' }

const PROJECT_REDIRECT_CACHE_KEY = 'bokito_home_redirect_v1'

function readCachedRedirect(): ProjectRedirect | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(PROJECT_REDIRECT_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ProjectRedirect
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

function writeCachedRedirect(redirect: ProjectRedirect): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(PROJECT_REDIRECT_CACHE_KEY, JSON.stringify(redirect))
  } catch {
    // ignore storage failures
  }
}

function TenantHomeRedirect() {
  const cached = readCachedRedirect()
  const [redirect, setRedirect] = useState<ProjectRedirect>(cached ?? { state: 'loading' })

  useEffect(() => {
    if (cached && cached.state !== 'loading') return
    let cancelled = false
    listProjects()
      .then((rows) => {
        if (cancelled) return
        let next: ProjectRedirect
        if (rows.length === 0) next = { state: 'none' }
        else if (rows.length === 1) next = { state: 'one', id: rows[0].id }
        else next = { state: 'many' }
        writeCachedRedirect(next)
        setRedirect(next)
      })
      .catch(() => {
        if (cancelled) return
        const next: ProjectRedirect = { state: 'error' }
        writeCachedRedirect(next)
        setRedirect(next)
      })
    return () => {
      cancelled = true
    }
  }, [cached])

  if (redirect.state === 'loading') {
    return <div className="py-6 text-sm text-text-muted">Loading your projects...</div>
  }
  if (redirect.state === 'none') return <Navigate to="/projects/new" replace />
  if (redirect.state === 'one') return <Navigate to={`/project/${redirect.id}/overview`} replace />
  if (redirect.state === 'many') return <Navigate to="/projects" replace />
  return <Navigate to="/projects" replace />
}

function HomeRoute() {
  const { workspaceLoading } = useWorkspace()
  const tenantSubdomain = resolveTenantSubdomainFromHost()

  if (workspaceLoading) {
    return <div className="py-6 text-sm text-text-muted">Workspaces laden...</div>
  }

  if (tenantSubdomain) {
    return <TenantHomeRedirect />
  }

  return (
    <WorkspaceHubLayout>
      <Workspaces />
    </WorkspaceHubLayout>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/onboarding" element={<Onboarding />} />

      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<HomeRoute />} />

        <Route element={<ControlPlaneRoute />}>
          <Route element={<WorkspaceHubLayout />}>
            <Route path="/billing" element={<WorkspaceBilling />} />
            <Route path="/account" element={<WorkspaceAccount />} />
            <Route path="/support" element={<WorkspaceSupport />} />
            <Route path="/workspaces" element={<Navigate to="/" replace />} />
            <Route path="/workspaces/billing" element={<Navigate to="/billing" replace />} />
            <Route path="/workspaces/account" element={<Navigate to="/account" replace />} />
            <Route path="/workspaces/support" element={<Navigate to="/support" replace />} />
          </Route>
        </Route>

        <Route element={<Layout />}>
          <Route path="/support/inbox/:queue" element={<Communication />} />
          <Route path="/support/inbox/:queue/t/:threadId" element={<Communication />} />
          <Route path="/support/inbox/ch/:channelId/:queue" element={<Communication />} />
          <Route path="/support/inbox/ch/:channelId/:queue/t/:threadId" element={<Communication />} />
          <Route path="/support/customization" element={<Navigate to={ASSISTENT_DEFAULT_PATH} replace />} />
          <Route path="/support/settings/general" element={<Navigate to="/settings/inbox" replace />} />

          <Route path="/users/:tab" element={<DatabasePageWithProvider />} />

          <Route path="/settings/profile" element={<ProfileSettings />} />
          <Route path="/settings/notifications" element={<NotificationSettings />} />
          <Route path="/settings/messenger" element={<Navigate to={ASSISTENT_DEFAULT_PATH} replace />} />
          <Route path="/settings/support/general" element={<Navigate to="/settings/inbox" replace />} />
          <Route path="/settings/help-centers" element={<HelpCentersSettings />} />
          <Route path="/settings/general" element={<WorkspaceSettings />} />
          <Route path="/settings/branding" element={<CompanyConfig />} />
          <Route path="/settings/members" element={<MemberManagement />} />
          <Route path="/settings/teams" element={<MemberManagement />} />
          <Route path="/settings/billing" element={<CompanyConfig />} />
          <Route path="/settings/access-security" element={<ProfileSettings />} />
          <Route path="/settings/inbox" element={<InboxSettings />} />
          <Route path="/settings/company" element={<CompanyConfig />} />
          <Route path="/settings/data/users" element={<DatabasePageWithProvider />} />
          <Route path="/settings/data/companies" element={<DatabasePageWithProvider />} />
          <Route path="/settings/data/conversations" element={<DatabasePageWithProvider />} />
          <Route path="/settings/data/imports-exports" element={<DatabasePageWithProvider />} />
          <Route path="/settings" element={<Navigate to="/settings/profile" replace />} />
          <Route path="/settings/integrations" element={<Navigate to="/integrations/connected" replace />} />
          <Route path="/settings/mcp" element={<Navigate to="/integrations/mcp" replace />} />
          <Route element={<IntegrationsLayout />}>
            <Route path="/integrations" element={<Navigate to="/integrations/connected" replace />} />
            <Route path="/integrations/connected" element={<IntegrationsConnected />} />
            <Route path="/integrations/marketplace" element={<IntegrationsMarketplace />} />
            <Route
              path="/integrations/connections"
              element={<Navigate to="/integrations/connected" replace />}
            />
            <Route path="/integrations/mcp" element={<IntegrationsMcp />} />
            <Route path="/integrations/api" element={<IntegrationsApi />} />
            <Route path="/integrations/sources" element={<DataSources />} />
          </Route>

          <Route path="/communication" element={<Communication />} />
          <Route path="/messages" element={<Communication />} />
          <Route path="/projects/new" element={<CreateProject />} />
          <Route path="/projects/new/:projectId/connect" element={<ConnectProjectRepo />} />
          <Route path="/projects" element={<Projects />} />
          <Route element={<ProjectLayout />}>
            <Route path="/project/:projectId" element={<Navigate to="overview" replace />} />
            <Route path="/project/:projectId/overview" element={<ProjectOverview />} />
            <Route path="/project/:projectId/pkb" element={<Navigate to="../doc" replace />} />
            <Route path="/project/:projectId/doc" element={<ProjectDoc />} />
            <Route path="/project/:projectId/doc/:pageSlug" element={<ProjectDoc />} />
            <Route path="/project/:projectId/request" element={<ChangeRequest />} />
            <Route path="/project/:projectId/messages" element={<ProjectMessages />} />
            <Route path="/project/:projectId/settings" element={<ProjectSettings />} />
          </Route>
          <Route path="/admin/runs/:workLogId" element={<AdminRuns />} />
          <Route path="/admin/runs" element={<AdminRuns />} />
          <Route path="/cloud-agent" element={<CloudAgent />} />
          <Route path="/datasources" element={<Navigate to="/integrations/sources" replace />} />
          <Route path="/ai/assistent" element={<Navigate to={ASSISTENT_DEFAULT_PATH} replace />} />
          <Route path="/ai/assistent/:audience/:section" element={<MessengerSettings />} />
          <Route path="/ai/communicatie" element={<AiCommunicationSettings />} />
          <Route path="/ai" element={<Navigate to={ASSISTENT_DEFAULT_PATH} replace />} />
          <Route path="/company-config" element={<Navigate to="/settings/company" replace />} />
          <Route path="/workforce" element={<Navigate to="/" replace />} />
          <Route path="/workforce/*" element={<Navigate to="/" replace />} />
          <Route path="/analytics" element={<Navigate to="/database" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>

        <Route element={<DatabaseLayout />}>
          <Route path="/database" element={<DatabasePage />} />
          <Route path="/database/:tableSlug" element={<DatabasePage />} />
          <Route path="/database/:tableSlug/record/:recordId" element={<DatabasePage />} />
        </Route>
      </Route>
    </Routes>
  )
}
