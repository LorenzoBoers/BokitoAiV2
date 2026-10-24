import type { DepartmentCrewRow, DepartmentOverview } from '../../lib/teams-api'

export function crewRow(patch: Partial<DepartmentCrewRow>): DepartmentCrewRow {
  return { kind: 'agent', id: 'a1', name: 'Boekito', role: 'member', focus: '', ...patch } as DepartmentCrewRow
}

export function department(patch: Partial<DepartmentOverview> = {}): DepartmentOverview {
  return {
    id: 'd1',
    name: 'Accounting',
    is_org: false,
    parent_id: 'root',
    path: [
      { id: 'root', name: 'Acme', href: '/organisatie' },
      { id: 'd1', name: 'Accounting', href: '/departments/d1' },
    ],
    children: [],
    contact: null,
    accountable: null,
    crew: [],
    admins: [],
    ...patch,
  } as unknown as DepartmentOverview
}
