import { test, expect } from '@playwright/test'
import { loginDashboard } from './helpers'

test.describe('Dashboard', () => {
  test('login shows cockpit', async ({ page }) => {
    await loginDashboard(page)
    await page.goto('/home')
    await expect(page.getByRole('heading', { name: 'Cockpit' })).toBeVisible({ timeout: 20000 })
    await expect(
      page.getByText(/Customer signals, agent work, and human decisions/i),
    ).toBeVisible({ timeout: 20000 })
  })

  test('messages hub redirects to my queue', async ({ page }) => {
    await loginDashboard(page)
    await page.goto('/messages')
    await expect(page).toHaveURL(/\/messages\/my/, { timeout: 20000 })
  })

  test('legacy routes redirect to consolidated nav', async ({ page }) => {
    await loginDashboard(page)
    await page.goto('/os')
    await expect(page).toHaveURL(/\/agents/, { timeout: 20000 })
    await page.goto('/orchestra')
    await expect(page).toHaveURL(/\/automations/, { timeout: 20000 })
    await page.goto('/communication')
    await expect(page).toHaveURL(/\/messages\/my/, { timeout: 20000 })
    await page.goto('/os/docs')
    await expect(page).toHaveURL(/\/workspace/, { timeout: 20000 })
  })

  test('awaiting decision queue lists seeded thread', async ({ page }) => {
    await loginDashboard(page)
    await page.goto('/messages/awaiting-decision')
    await expect(page.getByText('Goedkeuring: inbox routing rule')).toBeVisible({ timeout: 60000 })
  })

  test('all queue lists seeded external thread', async ({ page }) => {
    await loginDashboard(page)
    await page.goto('/messages/all')
    await expect(page.getByText('Vraag over facturatie')).toBeVisible({ timeout: 60000 })
  })

  test('govern page loads without home sidebar title', async ({ page }) => {
    await loginDashboard(page)
    await page.goto('/govern')
    await expect(page.getByRole('heading', { name: 'Govern' })).toBeVisible({ timeout: 20000 })
    await expect(page.getByRole('heading', { name: 'Home', exact: true })).toHaveCount(0)
  })

  test('agents page renders agent library', async ({ page }) => {
    await loginDashboard(page)
    await page.goto('/agents')
    await expect(page.getByRole('heading', { name: 'Agent library' })).toBeVisible({ timeout: 20000 })
  })

  test('workspace docs page renders', async ({ page }) => {
    await loginDashboard(page)
    await page.goto('/workspace')
    await expect(page.getByRole('heading', { name: 'Workspace' })).toBeVisible({ timeout: 20000 })
  })

  test('automations page renders with triggers tab', async ({ page }) => {
    await loginDashboard(page)
    await page.goto('/automations')
    await expect(page.getByRole('heading', { name: 'Automations' })).toBeVisible({ timeout: 20000 })
    await expect(page.getByRole('tab', { name: 'Triggers' })).toBeVisible({ timeout: 20000 })
  })

  test('integrations connected page loads', async ({ page }) => {
    await loginDashboard(page)
    await page.goto('/integrations/connected')
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 20000 })
  })
})
