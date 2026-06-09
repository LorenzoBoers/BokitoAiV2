import { test, expect } from '@playwright/test'
import { loginDashboard } from './helpers'

test.describe('Dashboard (bokito mode)', () => {
  test('login shows cockpit', async ({ page }) => {
    await loginDashboard(page)
    await page.goto('/home')
    await expect(page.getByRole('heading', { name: 'Cockpit' })).toBeVisible({ timeout: 20000 })
    await expect(
      page.getByText(/Customer signals, agent work, and human decisions/i),
    ).toBeVisible({ timeout: 20000 })
  })

  test('messages hub redirects to internal folder', async ({ page }) => {
    await loginDashboard(page)
    await page.goto('/messages')
    await expect(page).toHaveURL(/folder=internal/, { timeout: 20000 })
    await expect(page).toHaveURL(/\/messages\//, { timeout: 20000 })
  })

  test('legacy communication routes redirect to messages hub', async ({ page }) => {
    await loginDashboard(page)
    await page.goto('/os/communication')
    await expect(page).toHaveURL(/awaiting-decision.*folder=internal/, { timeout: 20000 })
  })

  test('legacy support inbox redirects to messages paths', async ({ page }) => {
    await loginDashboard(page)
    await page.goto('/support/inbox/all?folder=external')
    await expect(page).toHaveURL(/\/messages\/all\?folder=external/, { timeout: 20000 })
  })

  test('internal awaiting decision lists seeded thread', async ({ page }) => {
    await loginDashboard(page)
    await page.goto('/messages/awaiting-decision?folder=internal')
    await expect(page.getByText('Goedkeuring: inbox routing rule')).toBeVisible({ timeout: 60000 })
  })

  test('agenda loads without API error banner', async ({ page }) => {
    await loginDashboard(page)
    await page.goto('/agenda/month')
    await expect(page.getByRole('heading', { name: 'Agenda', level: 1 })).toBeVisible({ timeout: 20000 })
    await expect(page.getByRole('alert')).toHaveCount(0, { timeout: 15000 })
    await expect(page.getByTestId('agenda-month-view')).toBeVisible({ timeout: 20000 })
  })

  test('messages external folder lists seeded thread', async ({ page }) => {
    await loginDashboard(page)
    await page.goto('/messages/all?folder=external')
    await expect(page.getByText('Vraag over facturatie')).toBeVisible({ timeout: 60000 })
  })

  test('govern page loads without home sidebar title', async ({ page }) => {
    await loginDashboard(page)
    await page.goto('/govern')
    await expect(page.getByRole('heading', { name: 'Govern' })).toBeVisible({ timeout: 20000 })
    await expect(page.getByRole('heading', { name: 'Home', exact: true })).toHaveCount(0)
  })

  test('AI OS sidebar has no Decisions link', async ({ page }) => {
    await loginDashboard(page)
    await page.goto('/os')
    await expect(page.getByRole('link', { name: 'Decisions', exact: true })).toHaveCount(0)
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
    await expect(page.getByRole('heading', { name: 'AI OS', level: 1 })).toBeVisible({ timeout: 20000 })
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
    await expect(page.getByRole('heading', { name: 'Agenda', level: 1 })).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('agenda-month-view')).toBeVisible({ timeout: 20000 })
  })

  test('agenda can create an event', async ({ page }) => {
    await loginDashboard(page)
    await page.goto('/agenda/month')
    await expect(page.getByRole('heading', { name: 'Agenda', level: 1 })).toBeVisible({ timeout: 20000 })
    await page.getByRole('button', { name: 'New event' }).click()
    await page.getByLabel('Title').fill('E2E agenda event')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('E2E agenda event').first()).toBeVisible({ timeout: 30000 })
  })
})
