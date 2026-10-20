import { ThinkingTrace as SharedTrace } from '@bokito/ui'
import type { AgentStep } from '../hooks/useSignalStream'
import { stepLabel } from '../lib/agentSteps'
import { useCopy } from '../context/LocaleContext'

export default function ThinkingTrace({
  steps,
  active = false,
}: {
  steps: AgentStep[]
  active?: boolean
  compact?: boolean
}) {
  const { locale } = useCopy()
  return (
    <SharedTrace
      active={active}
      steps={steps.map((step, index) => ({
        id: String(index),
        label: stepLabel(step, locale),
      }))}
    />
  )
}
