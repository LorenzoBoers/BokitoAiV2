import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { loginDashboard } from './helpers'

type Row = { from: string; to: string }

const rows = JSON.parse(
  readFileSync(new URL('../apps/dashboard/src/lib/legacy-redirects.json', import.meta.url), 'utf8'),
) as Row[]

const staticRows = rows.filter((row) => !row.from.includes('*') && !row.from.includes(':'))

test('static legacy URLs redirect to their table target', async ({ page }) => {
  await loginDashboard(page)
  for (const row of staticRows) {
    await page.goto(row.from)
    const target = row.to.split('#')[0].split('?')[0]
    await expect(page).toHaveURL(new RegExp(`${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[?#])`), {
      timeout: 20000,
    })
  }
})
