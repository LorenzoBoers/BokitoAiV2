import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/layout/Layout'
import WorkspaceHubLayout from './components/layout/WorkspaceHubLayout'
import ProtectedRoute from './components/auth/ProtectedRoute'
import ControlPlaneRoute from './components/auth/ControlPlaneRoute'
import { useWorkspace } from './context/WorkspaceContext'
import { resolveTenantSubdomainFromHost } from './lib/host-routing'
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
import { messagesHubPath } from './components/layout/portal-nav'
import HelpCentersSettings from './pages/HelpCentersSettings'
import WorkspaceDocs from './pages/WorkspaceDocs'
import AiAgents from './pages/AiAgents'
import AiAgentDetail from './pages/AiAgentDetail'
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
import Cockpit from './pages/Cockpit'
import GovernPage from './pages/GovernPage'
import AutomationsPage from './pages/AutomationsPage'
import { useAuth } from './context/AuthContext'

function HomeRoute() {
  const { workspaceLoading, workspaces } = useWorkspace()
  const { user } = useAuth()
  const tenantSubdomain = resolveTenantSubdomainFromHost()

  if (workspaceLoading) {
    return <div className="py-6 text-sm text-text-muted">Loading workspaces...</div>
  }

  if (tenantSubdomain) {
    return <Navigate to="/home" replace />
  }

  const activeMemberships = (user?.memberships ?? []).filter((m) => m.status === 'active')
  if (activeMemberships.length === 1 && workspaces.length <= 1) {
    return <Navigate to="/home" replace />
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
          </Route>
        </Route>

        <Route element={<Layout />}>
          {/* Home */}
          <Route path="/home" element={<Cockpit />} />

          {/* Messages */}
          <Route path="/messages/:queue" element={<Communication />} />
          <Route path="/messages/:queue/t/:threadId" element={<Communication />} />
          <Route path="/messages/ch/:channelId/:queue" element={<Communication />} />
          <Route path="/messages/ch/:channelId/:queue/t/:threadId" element={<Communication />} />
          <Route path="/messages" element={<Navigate to={messagesHubPath()} replace />} />

          {/* Agents */}
          <Route path="/agents" element={<AiAgents />} />
          <Route path="/agents/:agentId" element={<AiAgentDetail />} />
          <Route path="/agents/:agentId/runs/:workLogId" element={<AiAgentDetail />} />
          <Route path="/ai/assistent" element={<Navigate to={ASSISTENT_DEFAULT_PATH} replace />} />
          <Route path="/ai/assistent/:audience/:section" element={<MessengerSettings />} />
          <Route path="/ai/communicatie" element={<AiCommunicationSettings />} />

          {/* Workspace docs */}
          <Route path="/workspace" element={<WorkspaceDocs />} />
          <Route path="/workspace/:docId" element={<WorkspaceDocs />} />

          {/* Automations (triggers + workstream runs) */}
          <Route path="/automations" element={<AutomationsPage />} />

          {/* Govern */}
          <Route path="/govern" element={<GovernPage />} />

          {/* Integrations */}
          <Route element={<IntegrationsLayout />}>
            <Route path="/integrations" element={<Navigate to="/integrations/connected" replace />} />
            <Route path="/integrations/connected" element={<IntegrationsConnected />} />
            <Route path="/integrations/marketplace" element={<IntegrationsMarketplace />} />
            <Route path="/integrations/mcp" element={<IntegrationsMcp />} />
            <Route path="/integrations/docs" element={<IntegrationsDocs />} />
            <Route path="/integrations/api" element={<IntegrationsApi />} />
          </Route>

          {/* Settings */}
          <Route path="/settings/profile" element={<ProfileSettings />} />
          <Route path="/settings/notifications" element={<NotificationSettings />} />
          <Route path="/settings/help-centers" element={<HelpCentersSettings />} />
          <Route path="/settings/general" element={<WorkspaceSettings />} />
          <Route path="/settings/branding" element={<CompanyConfig />} />
          <Route path="/settings/members" element={<MemberManagement />} />
          <Route path="/settings/teams" element={<MemberManagement />} />
          <Route path="/settings/access-security" element={<ProfileSettings />} />
          <Route path="/settings/inbox" element={<InboxSettings />} />
          <Route path="/settings/company" element={<CompanyConfig />} />
          <Route path="/settings" element={<Navigate to="/settings/profile" replace />} />

          {/* Legacy paths */}
          <Route path="/os" element={<Navigate to="/agents" replace />} />
          <Route path="/os/agents" element={<Navigate to="/agents" replace />} />
          <Route path="/os/docs" element={<Navigate to="/workspace" replace />} />
          <Route path="/os/docs/:docId" element={<Navigate to="/workspace" replace />} />
          <Route path="/orchestra" element={<Navigate to="/automations" replace />} />
          <Route path="/communication" element={<Navigate to={messagesHubPath()} replace />} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Route>
    </Routes>
  )
}
