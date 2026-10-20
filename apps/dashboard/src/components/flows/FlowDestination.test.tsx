/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FlowDestination } from './FlowDestination'
import type { WorkstreamDetail } from '../../lib/flows-api'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key }),
}))

const flow = (deliver_to: WorkstreamDetail['deliver_to']): WorkstreamDetail =>
  ({ id: 'w1', name: 'VAT filing', stages: [], tags: [], deliver_to }) as unknown as WorkstreamDetail

describe('FlowDestination', () => {
  afterEach(cleanup)

  it('shows folder and Works in item as one link', () => {
    render(
      <MemoryRouter>
        <FlowDestination
          flow={flow({
            folder_id: 'p1',
            folder_name: 'Administratie',
            works_in_key: 'resource:r1',
            item_kind: 'connection',
            item_label: 'Exact',
            href: '/folders/p1',
          })}
          canEdit={false}
          onSaved={() => {}}
        />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link').textContent).toBe('Administratie › Exact')
  })

  it('renders nothing for a member when unset', () => {
    const { container } = render(
      <MemoryRouter>
        <FlowDestination flow={flow(null)} canEdit={false} onSaved={() => {}} />
      </MemoryRouter>,
    )
    expect(container.innerHTML).toBe('')
  })
})
