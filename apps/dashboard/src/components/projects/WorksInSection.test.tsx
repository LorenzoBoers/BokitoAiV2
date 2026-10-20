/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorksInItem } from '../../lib/project-work-api'
import { WorksInSection } from './WorksInSection'

const items: WorksInItem[] = []

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('../../lib/project-work-api', () => ({
  listWorksIn: vi.fn(async () => items),
  addWorksIn: vi.fn(),
  deleteProjectResource: vi.fn(),
}))

vi.mock('../../lib/integrations-api', () => ({
  listIntegrationConnections: vi.fn(async () => []),
}))

function item(patch: Partial<WorksInItem>): WorksInItem {
  return {
    key: 'board',
    kind: 'board',
    origin: 'bokito',
    label: '',
    detail: '',
    href: '/folders/f1?tab=tickets',
    status: 'active',
    count: 3,
    ...patch,
  }
}

afterEach(() => {
  cleanup()
  items.length = 0
})

function renderSection(canEdit: boolean) {
  return render(
    <MemoryRouter>
      <WorksInSection projectId="f1" canEdit={canEdit} />
    </MemoryRouter>,
  )
}

describe('WorksInSection', () => {
  it('draws one card per item with its origin', async () => {
    items.push(
      item({}),
      item({ key: 'canvas:c1', kind: 'canvas', label: 'Cijfers', count: null, href: '/folders/f1?tab=canvas&canvas=c1' }),
      item({ key: 'resource:r1', kind: 'connection', origin: 'connection', label: 'Exact', count: null, href: '/settings/connections' }),
    )
    renderSection(false)
    await waitFor(() => expect(screen.getAllByTestId('works-in-item')).toHaveLength(3))
    expect(screen.getByText('Cijfers')).toBeTruthy()
    expect(screen.getByText('projects.worksIn.kind.board')).toBeTruthy()
    expect(screen.getAllByText(/projects\.worksIn\.origin\.bokito/)).toHaveLength(2)
    expect(screen.getAllByText(/projects\.worksIn\.origin\.connection/)).toHaveLength(1)
    expect(screen.queryByText('projects.worksIn.add')).toBeNull()
  })

  it('hides an empty section for readers and offers Add to admins', async () => {
    const { container } = renderSection(false)
    await waitFor(() => expect(container.querySelector('[data-testid="works-in-section"]')).toBeNull())
    cleanup()
    renderSection(true)
    await waitFor(() => expect(screen.getByText('projects.worksIn.add')).toBeTruthy())
    expect(screen.getByText('projects.worksIn.empty')).toBeTruthy()
  })
})
