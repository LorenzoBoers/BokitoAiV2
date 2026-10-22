/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiHandlingOverview } from '../../../lib/ai-handling-api'
import { AutonomyDial } from './AutonomyDial'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

function overview(patch: Partial<AiHandlingOverview> = {}): AiHandlingOverview {
  return {
    workspace: {} as AiHandlingOverview['workspace'],
    ceiling: 'assisted',
    clampedBy: null,
    safeguards: {} as AiHandlingOverview['safeguards'],
    breaker: {} as AiHandlingOverview['breaker'],
    disclosure: {} as AiHandlingOverview['disclosure'],
    routing: {} as AiHandlingOverview['routing'],
    disclosurePreview: null,
    exceptions: { channels: [], flows: [], conversations: [] },
    canRaise: true,
    ...patch,
  }
}

function card(mode: string): HTMLButtonElement {
  const el = screen.getByTestId(`autonomy-dial-${mode}`)
  return (el.tagName === 'BUTTON' ? el : el.querySelector('button') ?? el) as HTMLButtonElement
}

afterEach(cleanup)

describe('AutonomyDial', () => {
  it('shows three positions and marks the ceiling', () => {
    render(<AutonomyDial overview={overview()} error={null} saving={false} onChange={() => {}} />)
    for (const mode of ['manual', 'assisted', 'autonomous']) {
      expect(screen.getByTestId(`autonomy-dial-${mode}`)).toBeTruthy()
    }
    expect(screen.getAllByText('posture.current')).toHaveLength(1)
  })

  it('reports the picked position', () => {
    const onChange = vi.fn()
    render(<AutonomyDial overview={overview()} error={null} saving={false} onChange={onChange} />)
    fireEvent.click(card('autonomous'))
    expect(onChange).toHaveBeenCalledWith('autonomous')
  })

  it('locks the dial for members who may not raise it', () => {
    const onChange = vi.fn()
    render(
      <AutonomyDial overview={overview({ canRaise: false })} error={null} saving={false} onChange={onChange} />,
    )
    fireEvent.click(card('manual'))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByText('dial.adminOnly')).toBeTruthy()
  })

  it('explains the privacy lock', () => {
    render(
      <AutonomyDial overview={overview({ clampedBy: 'privacy' })} error={null} saving={false} onChange={() => {}} />,
    )
    expect(screen.getByText('aiHandling.clamped.privacy')).toBeTruthy()
  })
})
