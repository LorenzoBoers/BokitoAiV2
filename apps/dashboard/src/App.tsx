import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/layout/Layout'
import SettingsLayout from './components/layout/SettingsLayout'
import ProtectedRoute from './components/auth/ProtectedRoute'
import Login from './pages/Login'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import Onboarding from './pages/Onboarding'
import Home from './pages/Home'
import Communication from './pages/Communication'
import CloudAgent from './pages/CloudAgent'
import Integrations from './pages/Integrations'
import Projects from './pages/Projects'
import CompanyConfig from './pages/CompanyConfig'
import EmailSettings from './pages/EmailSettings'
import InboxSettings from './pages/InboxSettings'
import Analytics from './pages/Analytics'
import DatabasePage from './pages/DatabasePage'
import WorkspaceSettings from './pages/WorkspaceSettings'
import MemberManagement from './pages/MemberManagement'
import AuditLog from './pages/AuditLog'
import UsageDashboard from './pages/UsageDashboard'
import ProfileSettings from './pages/ProfileSettings'
import ApiDocs from './pages/ApiDocs'
import ApiSettings from './pages/ApiSettings'
import McpSettings from './pages/McpSettings'
import WorkforceControl from './pages/OrchestratorControl'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/onboarding" element={<Onboarding />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/communication" element={<Communication />} />
          <Route path="/cloud-agent" element={<CloudAgent />} />
          <Route path="/integrations" element={<Navigate to="/settings/integrations" replace />} />
          <Route path="/projects" element={<Navigate to="/datasources" replace />} />
          <Route path="/datasources" element={<Projects />} />
          <Route path="/company-config" element={<Navigate to="/settings/company-config" replace />} />
          <Route path="/settings" element={<SettingsLayout />}>
            <Route index element={<Navigate to="/settings/integrations" replace />} />
            <Route path="integrations" element={<Integrations />} />
            <Route path="email" element={<EmailSettings />} />
            <Route path="inbox" element={<InboxSettings />} />
            <Route path="communication-email" element={<Navigate to="/settings/email" replace />} />
            <Route path="company-config" element={<CompanyConfig />} />
            <Route path="workspace" element={<WorkspaceSettings />} />
            <Route path="members" element={<MemberManagement />} />
            <Route path="audit" element={<AuditLog />} />
            <Route path="usage" element={<UsageDashboard />} />
            <Route path="profile" element={<ProfileSettings />} />
            <Route path="api" element={<ApiSettings />} />
            <Route path="mcp" element={<McpSettings />} />
          </Route>
          <Route path="/docs" element={<ApiDocs />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/workforce" element={<WorkforceControl />} />
          <Route path="/database" element={<DatabasePage />} />
          <Route path="/database/:tableSlug" element={<DatabasePage />} />
          <Route path="/database/:tableSlug/record/:recordId" element={<DatabasePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Route>
    </Routes>
  )
}
