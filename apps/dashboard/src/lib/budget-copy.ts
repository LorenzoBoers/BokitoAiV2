/**
 * End-user copy for activity budget. Never use the word "token" in UI strings.
 */
export const BUDGET_LABELS = {
  dailyBudget: 'Daily activity budget',
  budgetNotice: 'Activity budget notice',
  budgetReached: 'Daily activity budget reached',
  increaseBudget: "Increase today's budget",
  remaining: (pct: number) => `About ${pct}% of today's activity budget remaining`,
} as const

export function formatBudgetRemaining(
  tokenUsedToday: number,
  tokenBudgetDaily: number
): string {
  if (tokenBudgetDaily <= 0) return BUDGET_LABELS.budgetReached
  const pct = Math.max(
    0,
    Math.min(100, Math.round((100 * (tokenBudgetDaily - tokenUsedToday)) / tokenBudgetDaily))
  )
  return BUDGET_LABELS.remaining(pct)
}

const FORBIDDEN_TOKEN_SUBSTRINGS = ['token budget', 'tokens remaining', 'raise your token']

export function assertNoTokenJargon(copy: string): void {
  const lower = copy.toLowerCase()
  for (const phrase of FORBIDDEN_TOKEN_SUBSTRINGS) {
    if (lower.includes(phrase)) {
      throw new Error(`Copy contains forbidden jargon: ${phrase}`)
    }
  }
}
