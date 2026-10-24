/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { crewRow, department } from './crew-fixture'
import { CrewBand, SubDepartments } from './DepartmentCrew'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

afterEach(cleanup)

describe('CrewBand', () => {
  it('shows the path, the contact first and marks an implicit contact', () => {
    const data = department({
      crew: [crewRow({ id: 'a2', name: 'Helper' }), crewRow({ id: 'a1', name: 'Boekito', role: 'contact' })],
      contact: { id: 'a1', name: 'Boekito', implicit: true } as never,
    })
    render(
      <MemoryRouter>
        <CrewBand data={data} canEdit={false} onEdit={() => {}} />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: 'Acme' }).getAttribute('href')).toBe('/organisatie')
    const names = screen.getAllByText(/Boekito|Helper/).map((el) => el.textContent)
    expect(names[0]).toBe('Boekito')
    expect(screen.getByText(/departmentPage.crew.implicit/)).toBeTruthy()
    expect(screen.queryByTestId('department-crew-edit')).toBeNull()
  })

  it('offers Edit to owners and admins', () => {
    render(
      <MemoryRouter>
        <CrewBand data={department()} canEdit onEdit={() => {}} />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('department-crew-edit')).toBeTruthy()
  })
})

describe('SubDepartments', () => {
  it('offers a new sub-department one level down and hides it at depth two', () => {
    const { rerender } = render(
      <MemoryRouter>
        <SubDepartments data={department()} canEdit />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('new-sub-department').getAttribute('href')).toContain('parent=d1')

    const deep = department({
      path: [
        { id: 'root', name: 'Acme', href: '/organisatie' },
        { id: 'd1', name: 'Accounting', href: '/departments/d1' },
        { id: 'd2', name: 'Payroll', href: '/departments/d2' },
      ] as never,
    })
    rerender(
      <MemoryRouter>
        <SubDepartments data={deep} canEdit />
      </MemoryRouter>,
    )
    expect(screen.queryByTestId('new-sub-department')).toBeNull()
  })
})
