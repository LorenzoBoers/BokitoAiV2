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
    await expect(page.getByText('Vraag over facturatie')).toBeVisible({ timeout: 60000 })
  })

  test('integrations connected page loads', async ({ page }) => {
    await loginDashboard(page)
    await page.goto('/integrations/connected')
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 20000 })
  })

  test('database route redirects to AI OS in bokito mode', async ({ page }) => {
    await loginDashboard(page)
    await page.goto('/database')
    await expect(page).toHaveURL(/\/os/, { timeout: 20000 })
  })

  test('AI OS workspace canvas and legacy redirects', async ({ page }) => {
    await loginDashboard(page)
    await page.goto('/os')
    await expect(page.getByRole('heading', { name: 'AI OS' })).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('os-workspace-canvas')).toBeVisible({ timeout: 20000 })
    await page.goto('/projects')
    await expect(page).toHaveURL(/\/os$/, { timeout: 20000 })
    await page.goto('/workforce/overview')
    await expect(page).toHaveURL(/\/os/, { timeout: 20000 })
  })

  test('orchestra and agenda routes render', async ({ page }) => {
    await loginDashboard(page)
    await page.goto('/orchestra')
    await expect(page.getByRole('heading', { name: 'Orchestra' })).toBeVisible({ timeout: 20000 })
    await page.goto('/agenda/month')
    await expect(page.getByRole('heading', { name: 'Agenda' })).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('agenda-month-view')).toBeVisible({ timeout: 20000 })
  })

  test('agenda can create an event', async ({ page }) => {
    await loginDashboard(page)
    await page.goto('/agenda/month')
    await expect(page.getByRole('heading', { name: 'Agenda' })).toBeVisible({ timeout: 20000 })
    await page.getByRole('button', { name: 'New event' }).click()
    await page.getByLabel('Title').fill('E2E agenda event')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('E2E agenda event').first()).toBeVisible({ timeout: 30000 })
  })
})
