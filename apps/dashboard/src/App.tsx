import { Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom'
import AppShell from './components/shell/AppShell'
import MessagesHub from './components/shell/MessagesHub'
import SettingsLayout from './components/shell/SettingsLayout'
import WorkspaceHubLayout from './components/layout/WorkspaceHubLayout'
import ProtectedRoute from './components/auth/ProtectedRoute'
import ControlPlaneRoute from './components/auth/ControlPlaneRoute'
import { useWorkspace } from './context/WorkspaceContext'
import { useAuth } from './context/AuthContext'
import { resolveTenantSubdomainFromHost } from './lib/host-routing'
import { ASSISTANT_DEFAULT_PATH } from './lib/assistant-settings-path'
import { useLanguagePreferenceSync } from './lib/language-preference'

// Public pages
import Login from './pages/Login'
import Signup from './pages/Signup'
import ForgotPassword from './pages/ForgotPassword'
import AcceptInvite from './pages/AcceptInvite'
import ResetPassword from './pages/ResetPassword'
import VerifyEmail from './pages/VerifyEmail'
// Chat (default surface)
import NewConversationPage from './pages/NewConversationPage'
import { agentChatPath, agentRunsPath, assistantPath, channelPath, inboxPath } from './lib/messages-paths'

// Control
import CockpitPage from './pages/CockpitPage'
import ContactsPage from './pages/ContactsPage'
import Communication from './pages/Communication'
import DirectCommunication from './pages/DirectCommunication'
import ActivityPage from './pages/ActivityPage'
import AgendaPage from './pages/AgendaPage'
import UsagePage from './pages/UsagePage'

// Agent
import AiAgents from './pages/AiAgents'
import AiAgentDetail from './pages/AiAgentDetail'
import WorkspaceDocs from './pages/WorkspaceDocs'

// Settings sections
import ProfileSettings from './pages/ProfileSettings'
import MyAssistantSettings from './pages/MyAssistantSettings'
import ModelsSettings from './pages/ModelsSettings'
import ProjectsSettings from './pages/ProjectsSettings'
import NotificationSettings from './pages/NotificationSettings'
import WorkspaceSettings from './pages/WorkspaceSettings'
import CompanyConfig from './pages/CompanyConfig'
import MemberManagement from './pages/MemberManagement'
import InboxSettings from './pages/InboxSettings'
import AiCommunicationSettings from './pages/AiCommunicationSettings'
import HelpCentersSettings from './pages/HelpCentersSettings'
import MessengerSettings from './pages/MessengerSettings'
import IntegrationsConnected from './pages/IntegrationsConnected'
import IntegrationsMarketplace from './pages/IntegrationsMarketplace'
import IntegrationsMcp from './pages/IntegrationsMcp'
import IntegrationSetupPage from './pages/IntegrationSetupPage'
import GovernPage from './pages/GovernPage'

// Control plane hub
import Workspaces from './pages/Workspaces'
import WorkspaceAccount from './pages/WorkspaceAccount'

function HomeRoute() {
  const { workspaceLoading, workspaces } = useWorkspace()
  const { user } = useAuth()
  const tenantSubdomain = resolveTenantSubdomainFromHost()

  if (workspaceLoading) {
    return <div className="py-6 text-sm text-text-muted">Loading workspaces...</div>
  }

  if (tenantSubdomain) {
    return <Navigate to={inboxPath('all')} replace />
  }

  const activeMemberships = (user?.memberships ?? []).filter((m) => m.status === 'active')
  if (activeMemberships.length === 1 && workspaces.length <= 1) {
    return <Navigate to={inboxPath('all')} replace />
  }

  return (
    <WorkspaceHubLayout>
      <Workspaces />
    </WorkspaceHubLayout>
  )
}

/** `/workspace/:docId` → `/knowledge/:docId`. */
function LegacyWorkspaceDocRedirect() {
  const { docId } = useParams<{ docId: string }>()
  return <Navigate to={`/knowledge/${docId ?? ''}`} replace />
}

/** Preserve query string on simple path redirects (OAuth callbacks, hub filters). */
function RedirectPreserveSearch({ to }: { to: string }) {
  const location = useLocation()
  return <Navigate to={`${to}${location.search}`} replace />
}

/** `/c/:conversationId` → `/communication/assistant/t/:conversationId`. */
function LegacyConversationRedirect() {
  const { conversationId } = useParams<{ conversationId: string }>()
  const location = useLocation()
  return <Navigate to={assistantPath(conversationId)} state={location.state} replace />
}

/** `/communication/chat/...` → assistant thread routes. */
function LegacyChatRedirect() {
  const { conversationId } = useParams<{ conversationId?: string }>()
  const location = useLocation()
  return <Navigate to={assistantPath(conversationId)} state={location.state} replace />
}

/** `/communication/direct/my[...]` → `/communication/assistant[...]`. */
function LegacyDirectMyRedirect() {
  const { threadId } = useParams<{ threadId?: string }>()
  const location = useLocation()
  return <Navigate to={`${assistantPath(threadId)}${location.search}`} state={location.state} replace />
}

/** `/communication/direct/agent/:agentId[...]` → `/communication/agent/:agentId[...]`. */
function LegacyDirectAgentRedirect() {
  const { agentId, threadId } = useParams<{ agentId: string; threadId?: string }>()
  const location = useLocation()
  return (
    <Navigate
      to={`${agentChatPath(agentId ?? '', threadId)}${location.search}`}
      state={location.state}
      replace
    />
  )
}

const LEGACY_CUSTOMER_QUEUE_MAP: Record<string, string> = {
  my: 'mine',
  mine: 'mine',
  all: 'open',
  open: 'open',
  unassigned: 'unassigned',
  closed: 'closed',
}

/** `/communication/customers/:queue[...]` → `/communication/inbox/:queue[...]`. */
function LegacyCustomersRedirect() {
  const { queue, channelId, threadId } = useParams<{ queue?: string; channelId?: string; threadId?: string }>()
  const location = useLocation()
  if (channelId) {
    return (
      <Navigate
        to={`${channelPath('email', { connectionId: channelId, threadId })}${location.search}`}
        replace
      />
    )
  }
  if (queue === 'awaiting-decision') {
    return <Navigate to={`${agentRunsPath('awaiting-decision', threadId)}${location.search}`} replace />
  }
  const target = LEGACY_CUSTOMER_QUEUE_MAP[queue ?? ''] ?? 'all'
  return <Navigate to={`${inboxPath(target as Parameters<typeof inboxPath>[0], threadId)}${location.search}`} replace />
}

const LEGACY_RUNS_QUEUE_MAP: Record<string, 'all' | 'updates' | 'results' | 'awaiting-decision'> = {
  all: 'all',
  updates: 'updates',
  results: 'results',
  'awaiting-decision': 'awaiting-decision',
}

/** `/communication/agents/:queue[...]` → `/communication/runs/:queue[...]`. */
function LegacyAgentsRedirect() {
  const { queue, threadId } = useParams<{ queue?: string; threadId?: string }>()
  const location = useLocation()
  const target = LEGACY_RUNS_QUEUE_MAP[queue ?? ''] ?? 'all'
  return <Navigate to={`${agentRunsPath(target, threadId)}${location.search}`} replace />
}

/** `/messages/...` → the new inbox/runs routes. */
function LegacyMessagesRedirect() {
  const location = useLocation()
  const rest = location.pathname.replace(/^\/messages\/?/, '')
  const isRuns =
    rest === 'updates' || rest === 'results' || rest.startsWith('updates/') || rest.startsWith('results/')
  const target = isRuns ? `/communication/agents/${rest}` : rest ? `/communication/customers/${rest}` : inboxPath('all')
  return <Navigate to={`${target}${location.search}`} replace />
}

/** `/inbox/...` → `/communication/...` (full hub rename). */
function LegacyInboxRedirect() {
  const location = useLocation()
  const rest = location.pathname.replace(/^\/inbox\/?/, '')
  const target = rest ? `/communication/${rest}` : inboxPath('all')
  return <Navigate to={`${target}${location.search}`} replace />
}

export default function App() {
  const { token } = useAuth()
  useLanguagePreferenceSync(token)
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/accept-invite" element={<AcceptInvite />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/verify-email" element={<VerifyEmail />} />

      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<HomeRoute />} />

        <Route element={<ControlPlaneRoute />}>
          <Route element={<WorkspaceHubLayout />}>
            <Route path="/account" element={<WorkspaceAccount />} />
            <Route path="/workspaces" element={<Workspaces />} />
          </Route>
        </Route>

        <Route element={<AppShell />}>
          {/* Communication hub: chats + customers + agents */}
          <Route element={<MessagesHub />}>
            <Route path="/communication" element={<Navigate to={inboxPath('all')} replace />} />
            <Route path="/communication/new" element={<NewConversationPage />} />

            {/* Inbox queues */}
            <Route path="/communication/inbox" element={<Navigate to={inboxPath('all')} replace />} />
            <Route path="/communication/inbox/:queue" element={<Communication />} />
            <Route path="/communication/inbox/:queue/t/:threadId" element={<Communication />} />

            {/* Assistant + agent chats */}
            <Route path="/communication/assistant" element={<DirectCommunication />} />
            <Route path="/communication/assistant/t/:threadId" element={<DirectCommunication />} />
            <Route path="/communication/agent/:agentId" element={<DirectCommunication />} />
            <Route path="/communication/agent/:agentId/t/:threadId" element={<DirectCommunication />} />

            {/* Agent runs */}
            <Route path="/communication/runs" element={<Navigate to={agentRunsPath('all')} replace />} />
            <Route path="/communication/runs/:queue" element={<Communication />} />
            <Route path="/communication/runs/:queue/t/:threadId" element={<Communication />} />

            {/* Channels */}
            <Route path="/communication/channel/email/:connectionId" element={<Communication />} />
            <Route path="/communication/channel/email/:connectionId/t/:threadId" element={<Communication />} />
            <Route path="/communication/channel/:channelKey" element={<Communication />} />
            <Route path="/communication/channel/:channelKey/t/:threadId" element={<Communication />} />

            {/* Legacy hub routes */}
            <Route path="/communication/chat" element={<LegacyChatRedirect />} />
            <Route path="/communication/chat/:conversationId" element={<LegacyChatRedirect />} />
            <Route path="/communication/direct" element={<Navigate to={assistantPath()} replace />} />
            <Route path="/communication/direct/my" element={<LegacyDirectMyRedirect />} />
            <Route path="/communication/direct/my/t/:threadId" element={<LegacyDirectMyRedirect />} />
            <Route path="/communication/direct/agent/:agentId" element={<LegacyDirectAgentRedirect />} />
            <Route path="/communication/direct/agent/:agentId/t/:threadId" element={<LegacyDirectAgentRedirect />} />
            <Route path="/communication/customers" element={<Navigate to={inboxPath('all')} replace />} />
            <Route path="/communication/customers/:queue" element={<LegacyCustomersRedirect />} />
            <Route path="/communication/customers/:queue/t/:threadId" element={<LegacyCustomersRedirect />} />
            <Route path="/communication/customers/ch/:channelId/:queue" element={<LegacyCustomersRedirect />} />
            <Route path="/communication/customers/ch/:channelId/:queue/t/:threadId" element={<LegacyCustomersRedirect />} />
            <Route path="/communication/agents" element={<Navigate to={agentRunsPath('all')} replace />} />
            <Route path="/communication/agents/:queue" element={<LegacyAgentsRedirect />} />
            <Route path="/communication/agents/:queue/t/:threadId" element={<LegacyAgentsRedirect />} />
          </Route>

          {/* Control */}
          <Route path="/cockpit" element={<CockpitPage />} />
          <Route path="/cockpit/activity" element={<ActivityPage />} />
          <Route path="/cockpit/usage" element={<UsagePage />} />
          <Route path="/contacts" element={<ContactsPage />} />
          <Route path="/contacts/:contactId" element={<ContactsPage />} />
          <Route path="/agenda" element={<AgendaPage />} />
          <Route path="/integrations/setup" element={<IntegrationSetupPage />} />
          <Route path="/triggers" element={<Navigate to="/agenda" replace />} />

          {/* Agent */}
          <Route path="/agents" element={<AiAgents />} />
          <Route path="/agents/:agentId" element={<AiAgentDetail />} />
          <Route path="/agents/:agentId/runs/:workLogId" element={<AiAgentDetail />} />
          <Route path="/knowledge" element={<WorkspaceDocs />} />
          <Route path="/knowledge/:docId" element={<WorkspaceDocs />} />

          {/* Settings */}
          <Route element={<SettingsLayout />}>
            <Route path="/settings" element={<Navigate to="/settings/general" replace />} />
            <Route path="/settings/profile" element={<ProfileSettings />} />
            <Route path="/settings/assistant" element={<MyAssistantSettings />} />
            <Route path="/settings/notifications" element={<NotificationSettings />} />
            <Route path="/settings/access-security" element={<Navigate to="/settings/profile" replace />} />
            <Route path="/settings/general" element={<WorkspaceSettings />} />
            <Route path="/settings/branding" element={<CompanyConfig />} />
            <Route path="/settings/members" element={<MemberManagement />} />
            <Route path="/settings/teams" element={<Navigate to="/settings/members" replace />} />
            <Route path="/settings/channels" element={<InboxSettings />} />
            <Route path="/settings/communication" element={<AiCommunicationSettings />} />
            <Route path="/settings/help-centers" element={<HelpCentersSettings />} />
            <Route path="/settings/integrations" element={<IntegrationsConnected />} />
            <Route path="/settings/marketplace" element={<IntegrationsMarketplace />} />
            <Route path="/settings/mcp" element={<IntegrationsMcp />} />
            <Route path="/settings/autonomy" element={<GovernPage />} />
            <Route path="/settings/models" element={<ModelsSettings />} />
            <Route path="/settings/projects" element={<ProjectsSettings />} />
            <Route path="/ai/assistant" element={<Navigate to={ASSISTANT_DEFAULT_PATH} replace />} />
            <Route path="/ai/assistant/:audience/:section" element={<MessengerSettings />} />
            {/* Legacy Dutch route name */}
            <Route path="/ai/assistent/*" element={<Navigate to={ASSISTANT_DEFAULT_PATH} replace />} />
          </Route>

          {/* Legacy redirects */}
          <Route path="/home" element={<Navigate to="/cockpit" replace />} />
          <Route path="/overview" element={<Navigate to="/cockpit" replace />} />
          <Route path="/activity" element={<Navigate to="/cockpit/activity" replace />} />
          <Route path="/usage" element={<Navigate to="/cockpit/usage" replace />} />
          <Route path="/skills" element={<Navigate to="/knowledge" replace />} />
          <Route path="/workspace" element={<Navigate to="/knowledge" replace />} />
          <Route path="/workspace/:docId" element={<LegacyWorkspaceDocRedirect />} />
          <Route path="/chat" element={<Navigate to={assistantPath()} replace />} />
          <Route path="/c/:conversationId" element={<LegacyConversationRedirect />} />
          <Route path="/sessions" element={<Navigate to={assistantPath()} replace />} />
          <Route path="/messages/*" element={<LegacyMessagesRedirect />} />
          <Route path="/messages" element={<LegacyMessagesRedirect />} />
          <Route path="/inbox/*" element={<LegacyInboxRedirect />} />
          <Route path="/inbox" element={<LegacyInboxRedirect />} />
          <Route path="/govern" element={<RedirectPreserveSearch to="/settings/autonomy" />} />
          <Route path="/automations" element={<Navigate to="/agenda" replace />} />
          <Route path="/orchestra" element={<Navigate to="/agenda" replace />} />
          <Route path="/integrations" element={<RedirectPreserveSearch to="/settings/integrations" />} />
          <Route path="/integrations/connected" element={<RedirectPreserveSearch to="/settings/integrations" />} />
          <Route path="/integrations/marketplace" element={<RedirectPreserveSearch to="/settings/marketplace" />} />
          <Route path="/integrations/mcp" element={<RedirectPreserveSearch to="/settings/mcp" />} />
          <Route path="/integrations/docs" element={<RedirectPreserveSearch to="/settings/integrations" />} />
          <Route path="/integrations/api" element={<RedirectPreserveSearch to="/settings/integrations" />} />
          <Route path="/settings/inbox" element={<Navigate to="/settings/channels" replace />} />
          <Route path="/settings/company" element={<Navigate to="/settings/branding" replace />} />
          <Route path="/ai/communicatie" element={<Navigate to="/settings/communication" replace />} />
          <Route path="/os" element={<Navigate to="/agents" replace />} />
          <Route path="/os/agents" element={<Navigate to="/agents" replace />} />
          <Route path="/os/docs" element={<Navigate to="/knowledge" replace />} />
          <Route path="/os/docs/:docId" element={<Navigate to="/knowledge" replace />} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Route>
    </Routes>
  )
}
