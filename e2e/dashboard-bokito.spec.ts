import { test, expect } from '@playwright/test'
import { loginDashboard } from './helpers'

test.describe('Dashboard (bokito mode)', () => {
  test('login shows cockpit', async ({ page }) => {
    await loginDashboard(page)
    await page.goto('/home')
    await expect(page.getByRole('heading', { name: 'Cockpit' })).toBeVisible({ timeout: 20000 })
  })

  test('inbox lists seeded threads', async ({ page }) => {
    await loginDashboard(page)
    await page.goto('/support/inbox/all')
    await expect(page.getByText('Vraag over facturatie')).toBeVisible({ timeout: 20000 })
  })

  test('integrations connected page loads', async ({ page }) => {
    await loginDashboard(page)
    await page.goto('/integrations/connected')
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 20000 })
  })

  test('database route is reachable', async ({ page }) => {
    await loginDashboard(page)
    await page.goto('/database')
    await expect(page).toHaveURL(/\/database/)
    await expect(page.locator('#email')).toHaveCount(0)
  })

  test('orchestra and agenda routes render', async ({ page }) => {
    await loginDashboard(page)
    await page.goto('/orchestra')
    await expect(page.getByRole('heading', { name: 'Orchestra' })).toBeVisible({ timeout: 20000 })
    await page.goto('/agenda')
    await expect(page.getByRole('heading', { name: 'Agenda' })).toBeVisible({ timeout: 20000 })
  })
})
