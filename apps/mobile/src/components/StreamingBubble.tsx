import { StreamingBubble as SharedStream } from '@bokito/ui'
import type { AgentStep } from '../hooks/useSignalStream'
import { stepLabel } from '../lib/agentSteps'
import { useCopy } from '../context/LocaleContext'

export default function StreamingBubble({
  text,
  steps = [],
  active,
}: {
  text: string
  steps?: AgentStep[]
  active?: boolean
}) {
  const { locale } = useCopy()
  return (
    <SharedStream
      text={text}
      active={!!active}
      steps={steps.map((step, index) => ({
        id: String(index),
        label: stepLabel(step, locale),
      }))}
    />
  )
}
