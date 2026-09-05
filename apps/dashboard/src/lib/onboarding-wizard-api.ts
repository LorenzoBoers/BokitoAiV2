import { appRoutes } from '../api/routes/app.routes'
import { appScopedGet, appScopedPatch } from './api'

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
  scope: 'owner' | 'member'
}

export type OnboardingWizardPatch = {
  intake?: Partial<WizardIntake>
  ai_workspace_language?: string
  autonomy_posture?: string
  complete?: boolean
}

export function getOnboardingWizard(token: string) {
  return appScopedGet<OnboardingWizardState>(appRoutes.onboarding.wizard, token)
}

export function patchOnboardingWizard(token: string, body: OnboardingWizardPatch) {
  return appScopedPatch<OnboardingWizardState>(appRoutes.onboarding.wizard, body, token)
}
