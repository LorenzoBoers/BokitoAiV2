import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/layout/Layout'
import DatabaseLayout from './components/layout/DatabaseLayout'
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
import DatabasePage, { DatabasePageWithProvider } from './pages/DatabasePage'
import ProfileSettings from './pages/ProfileSettings'
import NotificationSettings from './pages/NotificationSettings'
import CompanyConfig from './pages/CompanyConfig'
import MemberManagement from './pages/MemberManagement'
import MessengerSettings from './pages/MessengerSettings'
import HelpCentersSettings from './pages/HelpCentersSettings'
import ApiDocs from './pages/ApiDocs'
import CloudAgent from './pages/CloudAgent'
import Projects from './pages/Projects'
import DataSources from './pages/DataSources'
import WorkforceControl from './pages/OrchestratorControl'
import WorkspaceSettings from './pages/WorkspaceSettings'
import Workspaces from './pages/Workspaces'
import WorkspaceBilling from './pages/WorkspaceBilling'
import WorkspaceAccount from './pages/WorkspaceAccount'
import WorkspaceSupport from './pages/WorkspaceSupport'

function HomeRoute() {
  const { workspaceLoading } = useWorkspace()
  const tenantSubdomain = resolveTenantSubdomainFromHost()

  if (workspaceLoading) {
    return <div className="py-6 text-sm text-text-muted">Workspaces laden...</div>
  }

  if (tenantSubdomain) {
    return <Navigate to="/support/inbox/all" replace />
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
          <Route path="/support/inbox/ch/:channelId/:queue" element={<Communication />} />
          <Route path="/support/customization" element={<MessengerSettings />} />
          <Route path="/support/settings/general" element={<Navigate to="/settings/inbox" replace />} />

          <Route path="/users/:tab" element={<DatabasePageWithProvider />} />

          <Route path="/settings/profile" element={<ProfileSettings />} />
          <Route path="/settings/notifications" element={<NotificationSettings />} />
          <Route path="/settings/messenger" element={<Navigate to="/ai/assistent" replace />} />
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

          <Route path="/communication" element={<Communication />} />
          <Route path="/cloud-agent" element={<CloudAgent />} />
          <Route path="/integrations" element={<Navigate to="/settings/profile" replace />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/datasources" element={<DataSources />} />
          <Route path="/ai/assistent" element={<MessengerSettings />} />
          <Route path="/ai" element={<Navigate to="/projects" replace />} />
          <Route path="/company-config" element={<Navigate to="/settings/company" replace />} />
          <Route path="/docs" element={<ApiDocs />} />
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
