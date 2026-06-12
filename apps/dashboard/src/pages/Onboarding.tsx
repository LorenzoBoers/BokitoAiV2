import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Check } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { toast } from 'sonner'
import OnboardingStep1 from '../components/onboarding/OnboardingStep1'
import OnboardingStep2 from '../components/onboarding/OnboardingStep2'
import OnboardingStep3 from '../components/onboarding/OnboardingStep3'
import type { OnboardingStep1Data, OnboardingStep2Data, OnboardingStep3Data } from '../types/custom-db'

export default function Onboarding() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { createWorkspace } = useWorkspace()

  const [currentStep, setCurrentStep] = useState(1)
  const [isLoading, setIsLoading] = useState(false)

  const [step1Data, setStep1Data] = useState<OnboardingStep1Data>({
    workspace_name: '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  })

  const [step2Data, setStep2Data] = useState<OnboardingStep2Data>({
    first_surface: 'skip',
  })

  const [step3Data, setStep3Data] = useState<OnboardingStep3Data>({
    invites: [],
  })

  const totalSteps = 3

  const handleNext = async () => {
    if (currentStep < totalSteps) {
      setCurrentStep(currentStep + 1)
    } else {
      await handleComplete()
    }
  }

  const handlePrevious = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1)
    }
  }

  const handleComplete = async () => {
    setIsLoading(true)
    try {
      await createWorkspace({
        name: step1Data.workspace_name,
        timezone: step1Data.timezone,
      })

      toast.success('Welcome to Bokito. Your workspace is ready.')
      navigate('/communication/inbox/all', { replace: true })
    } catch (error) {
      console.error('Onboarding failed:', error)
      toast.error('Something went wrong while setting up your workspace.')
    } finally {
      setIsLoading(false)
    }
  }

  const canProceed = () => {
    switch (currentStep) {
      case 1:
        return step1Data.workspace_name.trim().length > 0
      case 2:
        return Boolean(step2Data.first_surface)
      case 3:
        return true
      default:
        return false
    }
  }

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return <OnboardingStep1 data={step1Data} onChange={setStep1Data} />
      case 2:
        return <OnboardingStep2 data={step2Data} onChange={setStep2Data} />
      case 3:
        return <OnboardingStep3 data={step3Data} onChange={setStep3Data} />
      default:
        return null
    }
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-4">
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-20%] left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-accent/10 blur-[120px]" />
      </div>

      <div className="relative w-full max-w-2xl">
        <div className="text-center mb-8">
          <img
            src="/bokito-logo-in-circel.svg"
            alt="Bokito.ai"
            className="w-12 h-12 mx-auto mb-4"
            onError={(e) => {
              ;(e.target as HTMLImageElement).style.display = 'none'
            }}
          />
          <h1 className="text-3xl font-bold text-text-heading mb-2">Welcome to Bokito</h1>
          <p className="text-text-secondary">Set up your workspace in {totalSteps} steps</p>
        </div>

        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            {Array.from({ length: totalSteps }).map((_, index) => {
              const stepNumber = index + 1
              const isActive = stepNumber === currentStep
              const isCompleted = stepNumber < currentStep

              return (
                <div key={stepNumber} className="flex items-center">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold transition-colors ${
                      isCompleted || isActive ? 'bg-accent text-white' : 'bg-bg-muted text-text-muted'
                    }`}
                  >
                    {isCompleted ? <Check className="w-5 h-5" /> : stepNumber}
                  </div>
                  {stepNumber < totalSteps ? (
                    <div
                      className={`w-20 h-1 mx-4 transition-colors ${
                        isCompleted ? 'bg-accent' : 'bg-bg-muted'
                      }`}
                    />
                  ) : null}
                </div>
              )
            })}
          </div>

          <div className="text-center">
            <span className="text-sm text-text-secondary">
              Step {currentStep} of {totalSteps}
            </span>
          </div>
        </div>

        <div className="bg-bg-surface border border-border rounded-xl p-8 shadow-xl">{renderStep()}</div>

        <div className="flex justify-between mt-8">
          <button
            type="button"
            onClick={handlePrevious}
            disabled={currentStep === 1}
            className="flex items-center gap-2 px-6 py-3 text-sm font-medium text-text-secondary hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            Back
          </button>

          <button
            type="button"
            onClick={() => void handleNext()}
            disabled={!canProceed() || isLoading}
            className="flex items-center gap-2 px-6 py-3 bg-accent hover:bg-accent-hover text-white text-sm font-semibold rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? (
              'Loading...'
            ) : currentStep === totalSteps ? (
              'Finish'
            ) : (
              <>
                Next
                <ChevronRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>

        <p className="text-center text-xs text-text-muted mt-6">Signed in as {user?.email}</p>
      </div>
    </div>
  )
}
