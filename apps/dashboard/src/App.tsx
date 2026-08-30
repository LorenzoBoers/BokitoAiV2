import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import AppShell from './components/shell/AppShell'
import MessagesHub from './components/shell/MessagesHub'
import SettingsLayout, { SettingsHomeRedirect } from './components/shell/SettingsLayout'
import WorkspaceHubLayout from './components/layout/WorkspaceHubLayout'
import ProtectedRoute from './components/auth/ProtectedRoute'
import ControlPlaneRoute from './components/auth/ControlPlaneRoute'
import { useWorkspace } from './context/WorkspaceContext'
import { useAuth } from './context/AuthContext'
import { resolveTenantSubdomainFromHost } from './lib/host-routing'
import { ASSISTANT_DEFAULT_PATH, WEBSITE_WIDGET_PATH } from './lib/assistant-settings-path'
import { useLanguagePreferenceSync, useOnboardingLanguageFromUrl } from './lib/language-preference'
import { lastInboxPath } from './lib/inbox-prefs'
import { CardGridSkeleton } from './components/ui/skeleton'
import { agentChatPath, agentRunsPath, channelPath, decisionsPath, inboxPath, newConversationPath } from './lib/messages-paths'

// Pages are lazy-loaded so each route becomes its own chunk.
// Public pages
const Login = lazy(() => import('./pages/Login'))
const Signup = lazy(() => import('./pages/Signup'))
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'))
const AcceptInvite = lazy(() => import('./pages/AcceptInvite'))
const ResetPassword = lazy(() => import('./pages/ResetPassword'))
const VerifyEmail = lazy(() => import('./pages/VerifyEmail'))
const HelpCenter = lazy(() => import('./pages/HelpCenter'))
const DocsPage = lazy(() => import('./pages/DocsPage'))
const DocsApiReference = lazy(() => import('./pages/DocsApiReference'))
// Chat (default surface)
const NewConversationPage = lazy(() => import('./pages/NewConversationPage'))

// Control
const CockpitPage = lazy(() => import('./pages/CockpitPage'))
const ContactsPage = lazy(() => import('./pages/ContactsPage'))
const Communication = lazy(() => import('./pages/Communication'))
const DirectCommunication = lazy(() => import('./pages/DirectCommunication'))
const ActivityPage = lazy(() => import('./pages/ActivityPage'))
const AgendaPage = lazy(() => import('./pages/AgendaPage'))
const UsagePage = lazy(() => import('./pages/UsagePage'))
const LearnPage = lazy(() => import('./pages/LearnPage'))

// Agent
const AiAgents = lazy(() => import('./pages/AiAgents'))
const AiAgentDetail = lazy(() => import('./pages/AiAgentDetail'))
const WorkspaceDocs = lazy(() => import('./pages/WorkspaceDocs'))

// Settings sections
const ProfileSettings = lazy(() => import('./pages/ProfileSettings'))
const ModelsSettings = lazy(() => import('./pages/ModelsSettings'))
const DeveloperSettings = lazy(() => import('./pages/DeveloperSettings'))
const ProjectsPage = lazy(() => import('./pages/ProjectsPage'))
const ProjectDetail = lazy(() => import('./pages/ProjectDetail'))
const NotificationSettings = lazy(() => import('./pages/NotificationSettings'))
const WorkspaceSettings = lazy(() => import('./pages/WorkspaceSettings'))
const CompanyConfig = lazy(() => import('./pages/CompanyConfig'))
const MemberManagement = lazy(() => import('./pages/MemberManagement'))
const InboxSettings = lazy(() => import('./pages/InboxSettings'))
const AiCommunicationSettings = lazy(() => import('./pages/AiCommunicationSettings'))
const HelpCentersSettings = lazy(() => import('./pages/HelpCentersSettings'))
const MessengerSettings = lazy(() => import('./pages/MessengerSettings'))
const IntegrationsConnected = lazy(() => import('./pages/IntegrationsConnected'))
const IntegrationsMarketplace = lazy(() => import('./pages/IntegrationsMarketplace'))
const ModulesPage = lazy(() => import('./pages/ModulesPage'))
const ModuleSetupPage = lazy(() => import('./pages/ModuleSetupPage'))
const ModuleWorkspacePage = lazy(() => import('./pages/ModuleWorkspacePage'))
const IntegrationsMcp = lazy(() => import('./pages/IntegrationsMcp'))
const SetupHubPage = lazy(() => import('./pages/SetupHubPage'))
const GovernPage = lazy(() => import('./pages/GovernPage'))

// Control plane hub
const Workspaces = lazy(() => import('./pages/Workspaces'))
const WorkspaceAccount = lazy(() => import('./pages/WorkspaceAccount'))

function RouteFallback() {
  const { t } = useTranslation('nav')
  return (
    <div className="px-5 py-6" role="status" aria-busy="true" aria-label={t('app.loading')}>
      <CardGridSkeleton cards={3} />
    </div>
  )
}

function LastInboxRedirect() {
  return <Navigate to={lastInboxPath()} replace />
}

function HomeRoute() {
  const { t } = useTranslation('nav')
  const { workspaceLoading, workspaces, currentWorkspace } = useWorkspace()
  const { user } = useAuth()
  const tenantSubdomain = resolveTenantSubdomainFromHost()

  if (workspaceLoading) {
    return <div className="py-6 text-sm text-text-muted">{t('app.loadingWorkspaces')}</div>
  }

  if (tenantSubdomain) {
    return <Navigate to={lastInboxPath()} replace />
  }

  // Daily login should resume work, not the workspace picker.
  // Switch workspaces from the user menu → Workspaces (`/workspaces`).
  if (currentWorkspace) {
    return <Navigate to={lastInboxPath()} replace />
  }

  const activeMemberships = (user?.memberships ?? []).filter((m) => m.status === 'active')
  if (activeMemberships.length === 1 && workspaces.length <= 1) {
    return <Navigate to={lastInboxPath()} replace />
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

/** Legacy Settings path for Modules → first-class `/modules` hub. */
function RedirectModulesLegacy() {
  const location = useLocation()
  const rest = location.pathname.replace(/^\/settings\/modules/, '') || ''
  return <Navigate to={`/modules${rest}${location.search}`} replace />
}

/** Legacy personal-assistant / bare chat URLs → New conversation (pick a company agent). */
function LegacyConversationRedirect() {
  const location = useLocation()
  return <Navigate to={newConversationPath()} state={location.state} replace />
}

/** `/communication/direct/my[...]` → New conversation (personal assistant removed). */
function LegacyDirectMyRedirect() {
  const location = useLocation()
  return <Navigate to={`${newConversationPath()}${location.search}`} state={location.state} replace />
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
    return <Navigate to={`${decisionsPath(threadId)}${location.search}`} replace />
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

/** `/communication/agents/:queue[...]` → `/communication/runs/:queue[...]` (or Decisions). */
function LegacyAgentsRedirect() {
  const { queue, threadId } = useParams<{ queue?: string; threadId?: string }>()
  const location = useLocation()
  const mapped = LEGACY_RUNS_QUEUE_MAP[queue ?? ''] ?? 'all'
  if (mapped === 'awaiting-decision') {
    return <Navigate to={`${decisionsPath(threadId)}${location.search}`} replace />
  }
  return <Navigate to={`${agentRunsPath(mapped, threadId)}${location.search}`} replace />
}

/** `/communication/runs/awaiting-decision[...]` → `/communication/decisions[...]`. */
function LegacyAwaitingDecisionRedirect() {
  const { threadId } = useParams<{ threadId?: string }>()
  const location = useLocation()
  return <Navigate to={`${decisionsPath(threadId)}${location.search}`} replace />
}

/** `/messages/...` → the new inbox/runs routes. */
function LegacyMessagesRedirect() {
  const location = useLocation()
  const rest = location.pathname.replace(/^\/messages\/?/, '')
  const isRuns =
    rest === 'updates' || rest === 'results' || rest.startsWith('updates/') || rest.startsWith('results/')
  const target = isRuns ? `/communication/agents/${rest}` : rest ? `/communication/customers/${rest}` : lastInboxPath()
  return <Navigate to={`${target}${location.search}`} replace />
}

/** `/inbox/...` → `/communication/...` (full hub rename). */
function LegacyInboxRedirect() {
  const location = useLocation()
  const rest = location.pathname.replace(/^\/inbox\/?/, '')
  const target = rest ? `/communication/${rest}` : lastInboxPath()
  return <Navigate to={`${target}${location.search}`} replace />
}

export default function App() {
  const { token } = useAuth()
  useOnboardingLanguageFromUrl()
  useLanguagePreferenceSync(token)
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/accept-invite" element={<AcceptInvite />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route path="/help/:tenantSlug" element={<HelpCenter />} />
      <Route path="/help/:tenantSlug/:articleSlug" element={<HelpCenter />} />
      <Route path="/docs" element={<DocsPage />} />
      <Route path="/docs/api" element={<DocsApiReference />} />
      <Route path="/docs/:section/:slug" element={<DocsPage />} />
      <Route path="/docs/:slug" element={<DocsPage />} />

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
            <Route path="/communication" element={<LastInboxRedirect />} />
            <Route path="/communication/new" element={<NewConversationPage />} />

            {/* Inbox queues */}
            <Route path="/communication/inbox" element={<LastInboxRedirect />} />
            <Route path="/communication/inbox/:queue" element={<Communication />} />
            <Route path="/communication/inbox/:queue/t/:threadId" element={<Communication />} />

            {/* Legacy personal assistant leaf → New chat */}
            <Route path="/communication/assistant/*" element={<Navigate to={newConversationPath()} replace />} />
            <Route path="/communication/assistant" element={<Navigate to={newConversationPath()} replace />} />

            {/* Company agent chats */}
            <Route path="/communication/agent/:agentId" element={<DirectCommunication />} />
            <Route path="/communication/agent/:agentId/t/:threadId" element={<DirectCommunication />} />
            <Route path="/communication/agent/:agentId/:queue" element={<DirectCommunication />} />
            <Route path="/communication/agent/:agentId/:queue/t/:threadId" element={<DirectCommunication />} />

            {/* Decisions — sole exception queue for open DecisionRequests */}
            <Route path="/communication/decisions" element={<Communication />} />
            <Route path="/communication/decisions/t/:threadId" element={<Communication />} />

            {/* Agent runs */}
            <Route path="/communication/runs" element={<Navigate to={agentRunsPath('all')} replace />} />
            <Route
              path="/communication/runs/awaiting-decision"
              element={<LegacyAwaitingDecisionRedirect />}
            />
            <Route
              path="/communication/runs/awaiting-decision/t/:threadId"
              element={<LegacyAwaitingDecisionRedirect />}
            />
            <Route path="/communication/runs/:queue" element={<Communication />} />
            <Route path="/communication/runs/:queue/t/:threadId" element={<Communication />} />

            {/* Channels (optionally nested sub-queue: /mine, /open, ...) */}
            <Route path="/communication/channel/email/:connectionId" element={<Communication />} />
            <Route path="/communication/channel/email/:connectionId/t/:threadId" element={<Communication />} />
            <Route path="/communication/channel/email/:connectionId/:queue" element={<Communication />} />
            <Route path="/communication/channel/email/:connectionId/:queue/t/:threadId" element={<Communication />} />
            <Route path="/communication/channel/:channelKey" element={<Communication />} />
            <Route path="/communication/channel/:channelKey/t/:threadId" element={<Communication />} />
            <Route path="/communication/channel/:channelKey/:queue" element={<Communication />} />
            <Route path="/communication/channel/:channelKey/:queue/t/:threadId" element={<Communication />} />

            {/* Tags (cross-channel folders with the same sub-queues) */}
            <Route path="/communication/tag/:tag" element={<Communication />} />
            <Route path="/communication/tag/:tag/t/:threadId" element={<Communication />} />
            <Route path="/communication/tag/:tag/:queue" element={<Communication />} />
            <Route path="/communication/tag/:tag/:queue/t/:threadId" element={<Communication />} />

            {/* Legacy hub routes */}
            <Route path="/communication/chat" element={<LegacyConversationRedirect />} />
            <Route path="/communication/chat/:conversationId" element={<LegacyConversationRedirect />} />
            <Route path="/communication/direct" element={<Navigate to={newConversationPath()} replace />} />
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
          <Route path="/contacts/companies/:companyId" element={<ContactsPage />} />
          <Route path="/contacts/:contactId" element={<ContactsPage />} />
          <Route path="/agenda" element={<AgendaPage />} />
          <Route path="/learn" element={<LearnPage />} />
          <Route path="/learn/:slug" element={<LearnPage />} />
          <Route path="/integrations/setup" element={<Navigate to="/settings/setup" replace />} />
          <Route path="/triggers" element={<Navigate to="/agenda" replace />} />

          {/* AI */}
          <Route path="/agents" element={<AiAgents />} />
          <Route path="/agents/:agentId" element={<AiAgentDetail />} />
          <Route path="/agents/:agentId/runs/:workLogId" element={<AiAgentDetail />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:projectId" element={<ProjectDetail />} />
          <Route path="/knowledge" element={<WorkspaceDocs />} />
          <Route path="/knowledge/:docId" element={<WorkspaceDocs />} />

          {/* Modules hub (first-class product surface) */}
          <Route path="/modules" element={<ModulesPage />} />
          <Route path="/modules/:slug" element={<ModuleSetupPage />} />
          <Route path="/ai/modules/:slug" element={<ModuleWorkspacePage />} />

          {/* Settings */}
          <Route element={<SettingsLayout />}>
            <Route path="/settings" element={<SettingsHomeRedirect />} />
            <Route path="/settings/setup" element={<SetupHubPage />} />
            <Route path="/settings/profile" element={<ProfileSettings />} />
            <Route path="/settings/assistant" element={<Navigate to={newConversationPath()} replace />} />
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
            <Route path="/settings/integrations/marketplace" element={<RedirectPreserveSearch to="/settings/marketplace" />} />
            <Route path="/settings/integrations/mcp" element={<RedirectPreserveSearch to="/settings/mcp" />} />
            <Route path="/settings/integrations/docs" element={<Navigate to="/settings/marketplace" replace />} />
            <Route path="/settings/marketplace" element={<IntegrationsMarketplace />} />
            <Route path="/settings/modules" element={<RedirectModulesLegacy />} />
            <Route path="/settings/modules/:slug" element={<RedirectModulesLegacy />} />
            <Route path="/settings/mcp" element={<IntegrationsMcp />} />
            <Route path="/settings/developers" element={<DeveloperSettings />} />
            <Route path="/settings/govern" element={<GovernPage />} />
            <Route path="/settings/autonomy" element={<RedirectPreserveSearch to="/settings/govern" />} />
            <Route path="/settings/models" element={<ModelsSettings />} />
            <Route path="/settings/projects" element={<Navigate to="/projects" replace />} />
            <Route path="/ai/assistant" element={<Navigate to={WEBSITE_WIDGET_PATH} replace />} />
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
          <Route path="/chat" element={<Navigate to={newConversationPath()} replace />} />
          <Route path="/c/:conversationId" element={<LegacyConversationRedirect />} />
          <Route path="/sessions" element={<Navigate to={newConversationPath()} replace />} />
          <Route path="/messages/*" element={<LegacyMessagesRedirect />} />
          <Route path="/messages" element={<LegacyMessagesRedirect />} />
          <Route path="/inbox/*" element={<LegacyInboxRedirect />} />
          <Route path="/inbox" element={<LegacyInboxRedirect />} />
          <Route path="/govern" element={<RedirectPreserveSearch to="/settings/govern" />} />
          <Route path="/automations" element={<Navigate to="/agenda?view=automations" replace />} />
          <Route path="/orchestra" element={<Navigate to="/agenda" replace />} />
          <Route path="/integrations" element={<RedirectPreserveSearch to="/settings/integrations" />} />
          <Route path="/integrations/connected" element={<RedirectPreserveSearch to="/settings/integrations" />} />
          <Route path="/integrations/marketplace" element={<RedirectPreserveSearch to="/settings/marketplace" />} />
          <Route path="/integrations/mcp" element={<RedirectPreserveSearch to="/settings/mcp" />} />
          <Route path="/settings/inbox" element={<Navigate to="/settings/channels" replace />} />
          <Route path="/settings/company" element={<Navigate to="/settings/branding" replace />} />
          <Route path="/settings/widget" element={<Navigate to={WEBSITE_WIDGET_PATH} replace />} />
          <Route path="/settings/chat-widget" element={<Navigate to={WEBSITE_WIDGET_PATH} replace />} />
          <Route path="/settings/website-widget" element={<Navigate to={WEBSITE_WIDGET_PATH} replace />} />
          <Route path="/ai/communicatie" element={<Navigate to="/settings/communication" replace />} />
          <Route path="/os" element={<Navigate to="/agents" replace />} />
          <Route path="/os/agents" element={<Navigate to="/agents" replace />} />
          <Route path="/os/docs" element={<Navigate to="/knowledge" replace />} />
          <Route path="/os/docs/:docId" element={<Navigate to="/knowledge" replace />} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Route>
      </Routes>
    </Suspense>
  )
}
