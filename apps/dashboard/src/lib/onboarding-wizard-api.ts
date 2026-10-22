import { appRoutes } from '../api/routes/app.routes'
import { appScopedGet, appScopedPatch, appScopedPost } from './api'

export type WizardIntake = {
  source: string
  org_size: string
  use_case: string
}

export type WizardLeadAgent = {
  id: string
  name: string
  avatar_kind: string | null
  avatar_icon: string | null
  avatar_color: string | null
  avatar_shape: string | null
  job_title: string | null
  description: string | null
}

export type OnboardingWizardState = {
  wizard_required: boolean
  wizard_completed_at: string | null
  needs_wizard: boolean
  needs_personal_wizard: boolean
  personal_wizard_completed: boolean
  intake: WizardIntake
  ai_workspace_language: string
  autonomy_posture: string
  lead_agent: WizardLeadAgent | null
  suggested_agent_name: string
  scope: 'owner' | 'member'
}

export type OnboardingWizardPatch = {
  intake?: Partial<WizardIntake>
  ai_workspace_language?: string
  autonomy_posture?: string
  lead_agent?: {
    name: string
    job_title?: string
    description?: string
    avatar_kind?: string
    avatar_icon?: string | null
    avatar_color?: string | null
    avatar_shape?: string | null
  }
  complete?: boolean
}

export function startOnboardingSetupThread(token: string) {
  return appScopedPost<{
    signal_id: string
    agent_id: string
    channel: string
    created: string
    started: boolean
  }>(appRoutes.onboarding.setupThread, {}, token)
}

export function getOnboardingWizard(token: string) {
  return appScopedGet<OnboardingWizardState>(appRoutes.onboarding.wizard, token)
}

export function patchOnboardingWizard(token: string, body: OnboardingWizardPatch) {
  return appScopedPatch<OnboardingWizardState>(appRoutes.onboarding.wizard, body, token)
}
