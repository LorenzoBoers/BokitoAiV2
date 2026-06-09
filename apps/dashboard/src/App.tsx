import { useEffect, useState } from 'react'
import { Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom'
import Layout from './components/layout/Layout'
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
import ProfileSettings from './pages/ProfileSettings'
import NotificationSettings from './pages/NotificationSettings'
import CompanyConfig from './pages/CompanyConfig'
import MemberManagement from './pages/MemberManagement'
import MessengerSettings from './pages/MessengerSettings'
import { ASSISTENT_DEFAULT_PATH } from './lib/assistent-settings-path'
import { AI_OS_DEFAULT_PATH, WORKFORCE_DEFAULT_PATH, projectOrchestratorPath, messagesHubPath } from './components/layout/portal-nav'
import HelpCentersSettings from './pages/HelpCentersSettings'
import CreateProject from './pages/CreateProject'
import ProjectHubShell from './components/layout/ProjectHubShell'
import ProjectHubOverview from './pages/ProjectHubOverview'
import ProjectHubDocs from './pages/ProjectHubDocs'
import ProjectLayout from './components/layout/ProjectLayout'
import ProjectOverview from './pages/ProjectOverview'
import ProjectSettings from './pages/ProjectSettings'
import ProjectOrchestration from './pages/ProjectOrchestration'
import ProjectPoConfig from './pages/ProjectPoConfig'
import ProjectNotifications from './pages/ProjectNotifications'
import ProjectWorkforceHistory from './pages/ProjectWorkforceHistory'
import ProjectUsage from './pages/ProjectUsage'
import ConnectProjectRepo from './pages/ConnectProjectRepo'
import AdminRunLegacyRedirect from './pages/AdminRunLegacyRedirect'
import AiAgents from './pages/AiAgents'
import AiAgentDetail from './pages/AiAgentDetail'
import AiOsCanvas from './pages/AiOsCanvas'
import ProjectWorkforceRunDetail from './pages/ProjectWorkforceRunDetail'
import WorkforcePoAgents from './pages/WorkforcePoAgents'
import AiCommunicationSettings from './pages/AiCommunicationSettings'
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
import IntegrationsDocs from './pages/IntegrationsDocs'
import HomeDashboard from './pages/HomeDashboard'
import Cockpit from './pages/Cockpit'
import GovernPage from './pages/GovernPage'
import OrchestraPage from './pages/OrchestraPage'
import AgendaPage from './pages/AgendaPage'
import DatabasePage from './pages/DatabasePage'
import DatabaseRouteLayout from './components/layout/DatabaseRouteLayout'
import { useIsAdmin } from './hooks/useIsAdmin'
import { isBokitoMode } from './lib/bokito-mode'
import { useAuth } from './context/AuthContext'

const USE_BOKITO_API = isBokitoMode()

function LegacyInboxRedirect() {
  const { queue, threadId, channelId } = useParams<{
    queue?: string
    threadId?: string
    channelId?: string
  }>()
  const location = useLocation()
  let target: string
  if (channelId && queue) {
    target = threadId
      ? `/messages/ch/${channelId}/${queue}/t/${threadId}`
      : `/messages/ch/${channelId}/${queue}`
  } else if (queue) {
    target = threadId ? `/messages/${queue}/t/${threadId}` : `/messages/${queue}`
  } else {
    target = messagesHubPath({ folder: 'internal' })
  }
  return <Navigate to={`${target}${location.search}`} replace />
}

function LegacyOsProjectRedirect() {
  const { projectId } = useParams<{ projectId: string }>()
  if (!projectId) return <Navigate to="/os" replace />
  return <Navigate to={`/project/${projectId}/overview`} replace />
}

function LegacyProjectPoRedirect() {
  const { projectId } = useParams<{ projectId: string }>()
  if (!projectId) return <Navigate to="/os" replace />
  return <Navigate to={projectOrchestratorPath(projectId)} replace />
}

function ProjectInboxRedirect() {
  const { projectId } = useParams<{ projectId: string }>()
  if (!projectId) return <Navigate to={messagesHubPath({ folder: 'internal' })} replace />
  return <Navigate to={messagesHubPath({ folder: 'internal', queue: 'all', projectId })} replace />
}

function ProjectCommunicationRedirect() {
  const { projectId } = useParams<{ projectId: string }>()
  if (!projectId) return <Navigate to={messagesHubPath({ folder: 'internal' })} replace />
  return <Navigate to={messagesHubPath({ folder: 'internal', queue: 'my', projectId })} replace />
}

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
  const isAdmin = useIsAdmin()
  const cached = readCachedRedirect()
  const [redirect, setRedirect] = useState<ProjectRedirect>(cached ?? { state: 'loading' })

  useEffect(() => {
    if (isAdmin) return
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
  }, [cached, isAdmin])

  if (isAdmin) {
    return <Navigate to="/home" replace />
  }

  if (redirect.state === 'loading') {
    return <div className="py-6 text-sm text-text-muted">Loading your projects...</div>
  }
  if (redirect.state === 'none') return <Navigate to="/projects/new" replace />
  if (redirect.state === 'one') return <Navigate to={`/project/${redirect.id}/overview`} replace />
  if (redirect.state === 'many') return <Navigate to="/home" replace />
  return <Navigate to="/home" replace />
}

function HomeRoute() {
  const { workspaceLoading, workspaces } = useWorkspace()
  const { user } = useAuth()
  const tenantSubdomain = resolveTenantSubdomainFromHost()

  if (workspaceLoading) {
    return <div className="py-6 text-sm text-text-muted">Loading workspaces...</div>
  }

  if (tenantSubdomain) {
    return <TenantHomeRedirect />
  }

  if (USE_BOKITO_API) {
    const activeMemberships = (user?.memberships ?? []).filter((m) => m.status === 'active')
    if (activeMemberships.length === 1 && workspaces.length <= 1) {
      return <Navigate to="/home" replace />
    }
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
          <Route path="/home" element={USE_BOKITO_API ? <Cockpit /> : <HomeDashboard />} />
          {USE_BOKITO_API ? (
            <>
              <Route path="/orchestra" element={<OrchestraPage />} />
              <Route path="/agenda" element={<Navigate to="/agenda/month" replace />} />
              <Route path="/agenda/:view" element={<AgendaPage />} />
              <Route path="/govern" element={<GovernPage />} />
            </>
          ) : null}
          <Route path="/messages/:queue" element={<Communication />} />
          <Route path="/messages/:queue/t/:threadId" element={<Communication />} />
          <Route path="/messages/ch/:channelId/:queue" element={<Communication />} />
          <Route path="/messages/ch/:channelId/:queue/t/:threadId" element={<Communication />} />
          <Route path="/support/inbox/:queue" element={<LegacyInboxRedirect />} />
          <Route path="/support/inbox/:queue/t/:threadId" element={<LegacyInboxRedirect />} />
          <Route path="/support/inbox/ch/:channelId/:queue" element={<LegacyInboxRedirect />} />
          <Route path="/support/inbox/ch/:channelId/:queue/t/:threadId" element={<LegacyInboxRedirect />} />
          <Route path="/support/customization" element={<Navigate to={ASSISTENT_DEFAULT_PATH} replace />} />
          <Route path="/support/settings/general" element={<Navigate to="/settings/inbox" replace />} />

          <Route path="/users/:tab" element={<Navigate to="/os" replace />} />
          <Route path="/data/sources" element={<Navigate to="/os" replace />} />
          <Route path="/data/imports-exports" element={<Navigate to="/os" replace />} />

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
          <Route path="/settings/data/users" element={<Navigate to="/os" replace />} />
          <Route path="/settings/data/companies" element={<Navigate to="/os" replace />} />
          <Route path="/settings/data/conversations" element={<Navigate to="/os" replace />} />
          <Route path="/settings/data/imports-exports" element={<Navigate to="/os" replace />} />
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
            <Route path="/integrations/docs" element={<IntegrationsDocs />} />
            <Route path="/integrations/api" element={<IntegrationsApi />} />
            <Route path="/integrations/sources" element={<Navigate to="/os" replace />} />
          </Route>

          <Route path="/support/inbox/mine/t/:threadId" element={<Navigate to="/support/inbox/my/t/:threadId" replace />} />
          <Route path="/support/inbox/mine" element={<Navigate to="/support/inbox/my" replace />} />
          <Route path="/communication" element={<Navigate to={messagesHubPath({ folder: 'internal' })} replace />} />
          <Route path="/messages" element={<Navigate to={messagesHubPath({ folder: 'internal' })} replace />} />
          <Route path="/os" element={<AiOsCanvas />} />
          <Route path="/os/agents" element={<AiAgents />} />
          <Route path="/os/agents/:agentId" element={<AiAgentDetail />} />
          <Route path="/os/agents/:agentId/runs/:workLogId" element={<AiAgentDetail />} />
          <Route
            path="/os/communication"
            element={<Navigate to={messagesHubPath({ folder: 'internal', queue: 'awaiting-decision' })} replace />}
          />
          <Route path="/os/docs" element={<ProjectHubDocs />} />
          <Route path="/os/docs/:pageSlug" element={<ProjectHubDocs />} />
          <Route path="/os/project/:projectId" element={<LegacyOsProjectRedirect />} />
          <Route path="/projects/new" element={<CreateProject />} />
          <Route path="/projects/new/:projectId/connect" element={<ConnectProjectRepo />} />
          <Route path="/projects" element={<Navigate to="/os" replace />} />
          <Route path="/projects/list" element={<Navigate to="/os" replace />} />
          <Route path="/projects/communication" element={<Navigate to={messagesHubPath({ folder: 'internal', queue: 'awaiting-decision' })} replace />} />
          <Route path="/projects/docs" element={<Navigate to="/os/docs" replace />} />
          <Route path="/projects/docs/:pageSlug" element={<Navigate to="/os/docs/:pageSlug" replace />} />
          <Route element={<ProjectHubShell />}>
            <Route path="/projects/overview-legacy" element={<ProjectHubOverview />} />
          </Route>
          <Route element={<ProjectLayout />}>
            <Route path="/project/:projectId" element={<Navigate to="overview" replace />} />
            <Route path="/project/:projectId/overview" element={<ProjectOverview />} />
            <Route
              path="/project/:projectId/pkb"
              element={<Navigate to="/os/docs" replace />}
            />
            <Route
              path="/project/:projectId/doc"
              element={<Navigate to="/os/docs" replace />}
            />
            <Route
              path="/project/:projectId/doc/:pageSlug"
              element={<Navigate to="/os/docs" replace />}
            />
            <Route path="/project/:projectId/request" element={<Navigate to="/os/docs" replace />} />
            <Route
              path="/project/:projectId/messages"
              element={<ProjectInboxRedirect />}
            />
            <Route path="/project/:projectId/communication" element={<ProjectCommunicationRedirect />} />
            <Route path="/project/:projectId/orchestration" element={<ProjectOrchestration />} />
            <Route path="/project/:projectId/orchestrator" element={<ProjectPoConfig />} />
            <Route path="/project/:projectId/po" element={<LegacyProjectPoRedirect />} />
            <Route path="/project/:projectId/notifications" element={<ProjectNotifications />} />
            <Route path="/project/:projectId/workforce" element={<ProjectWorkforceHistory />} />
            <Route
              path="/project/:projectId/workforce/:workLogId"
              element={<ProjectWorkforceRunDetail />}
            />
            <Route path="/project/:projectId/usage" element={<ProjectUsage />} />
            <Route path="/project/:projectId/settings" element={<ProjectSettings />} />
          </Route>
          <Route path="/admin/runs/:workLogId" element={<AdminRunLegacyRedirect />} />
          <Route path="/admin/runs" element={<Navigate to={WORKFORCE_DEFAULT_PATH} replace />} />
          <Route path="/workforce" element={<Navigate to={AI_OS_DEFAULT_PATH} replace />} />
          <Route path="/workforce/overview" element={<Navigate to={AI_OS_DEFAULT_PATH} replace />} />
          <Route path="/workforce/agents" element={<Navigate to="/os/agents" replace />} />
          <Route path="/workforce/po" element={<Navigate to="/os/agents" replace />} />
          <Route path="/ai/agents" element={<Navigate to="/os/agents" replace />} />
          <Route path="/ai/agents/:agentId" element={<AiAgentDetail />} />
          <Route path="/ai/agents/:agentId/runs/:workLogId" element={<AiAgentDetail />} />
          <Route path="/cloud-agent" element={<Navigate to="/home" replace />} />
          <Route path="/datasources" element={<Navigate to="/os" replace />} />
          <Route path="/ai/assistent" element={<Navigate to={ASSISTENT_DEFAULT_PATH} replace />} />
          <Route path="/ai/assistent/:audience/:section" element={<MessengerSettings />} />
          <Route path="/ai/communicatie" element={<AiCommunicationSettings />} />
          <Route path="/ai" element={<Navigate to={AI_OS_DEFAULT_PATH} replace />} />
          <Route path="/company-config" element={<Navigate to="/settings/company" replace />} />
          <Route path="/workforce/*" element={<Navigate to={AI_OS_DEFAULT_PATH} replace />} />
          <Route path="/analytics" element={<Navigate to="/os" replace />} />
          {USE_BOKITO_API ? (
            <>
              <Route path="/database" element={<Navigate to="/os" replace />} />
              <Route path="/database/*" element={<Navigate to="/os" replace />} />
            </>
          ) : (
            <>
              <Route path="/database" element={<Navigate to="/os" replace />} />
              <Route path="/database/*" element={<Navigate to="/os" replace />} />
            </>
          )}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Route>
    </Routes>
  )
}
