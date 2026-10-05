import { listCasesForSignal, patchCase, type CaseRow } from './cases-api'

/** An open ticket that should not silently stay open after the conversation closes. */
export function isOpenSignalCase(row: CaseRow): boolean {
  if (!row.is_ticket) return false
  return row.status !== 'done' && row.status !== 'proposed'
}

export async function loadOpenSignalCases(signalId: string): Promise<CaseRow[]> {
  const rows = await listCasesForSignal(signalId).catch(() => [])
  return rows.filter(isOpenSignalCase)
}

export async function resolveOpenSignalCases(cases: CaseRow[]): Promise<void> {
  await Promise.all(cases.map((row) => patchCase(row.id, { status: 'done' })))
}
