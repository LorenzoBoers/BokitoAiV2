import type { UsageBreakdown } from './bokito-api'

function csvCell(value: string | number): string {
  const raw = String(value)
  if (/[",\n]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`
  return raw
}

/** Flatten usage breakdown into a downloadable CSV. */
export function usageBreakdownToCsv(breakdown: UsageBreakdown): string {
  const rows: string[] = ['section,name,tokens,customer_cost_micros,billable']
  for (const row of breakdown.by_model) {
    rows.push(
      [
        'model',
        csvCell(row.model),
        row.tokens,
        row.customer_cost_micros,
        row.billable ? 'yes' : 'no',
      ].join(','),
    )
  }
  for (const row of breakdown.by_agent) {
    rows.push(
      ['agent', csvCell(row.agent_name), row.tokens, row.customer_cost_micros, ''].join(','),
    )
  }
  for (const row of breakdown.by_user ?? []) {
    rows.push(
      ['user', csvCell(row.user_name), row.tokens, row.customer_cost_micros, ''].join(','),
    )
  }
  return `${rows.join('\n')}\n`
}

export function parseUsageDays(value: string | null): 7 | 30 | 90 {
  if (value === '7' || value === '90') return Number(value) as 7 | 90
  return 30
}
