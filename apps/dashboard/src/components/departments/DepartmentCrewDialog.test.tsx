/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { crewRow, department } from './crew-fixture'
import { DepartmentCrewDialog } from './DepartmentCrew'

const setDepartmentCrew = vi.fn(async () => ({ crew: [], previous: [] }))
const confirm = vi.fn(async () => true)

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ token: 'token' }),
}))

vi.mock('../ui/confirm-dialog', () => ({
  useConfirm: () => confirm,
}))

vi.mock('../../lib/teams-api', () => ({
  getTeamOverview: vi.fn(async () => ({ people: [], agents: [], teams: [] })),
  setDepartmentCrew: (...args: unknown[]) => setDepartmentCrew(...(args as [])),
}))

afterEach(() => {
  cleanup()
  setDepartmentCrew.mockClear()
  confirm.mockClear()
})

describe('DepartmentCrewDialog', () => {
  it('warns on the organization and names the admins there by role', () => {
    const data = department({
      is_org: true,
      admins: [crewRow({ kind: 'user', id: 'u1', name: 'Sam', workspace_role: 'owner' })],
    })
    render(<DepartmentCrewDialog data={data} open onOpenChange={() => {}} onSaved={() => {}} />)
    expect(screen.getByText('departmentPage.crew.orgWarning')).toBeTruthy()
    expect(screen.getByText('departmentPage.crew.adminsLine')).toBeTruthy()
  })

  it('keeps an implicit contact implicit on save, without asking to confirm', async () => {
    const data = department({
      crew: [crewRow({ id: 'a1', name: 'Boekito', role: 'contact' })],
      contact: { id: 'a1', name: 'Boekito', implicit: true } as never,
    })
    render(<DepartmentCrewDialog data={data} open onOpenChange={() => {}} onSaved={() => {}} />)
    expect(screen.queryByText('departmentPage.crew.orgWarning')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'departmentPage.crew.save' }))
    await waitFor(() => expect(setDepartmentCrew).toHaveBeenCalled())
    expect(confirm).not.toHaveBeenCalled()
    expect(setDepartmentCrew).toHaveBeenCalledWith('token', 'd1', [{ kind: 'agent', id: 'a1', role: 'member', focus: '' }])
  })
})
