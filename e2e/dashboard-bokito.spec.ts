import { test, expect } from '@playwright/test'
import { loginDashboard } from './helpers'

test.describe('Dashboard', () => {
  test('new conversation leaf is reachable from the communication hub', async ({ page }) => {
    await loginDashboard(page)
    await page.goto('/communication/new')
    await expect(page.getByText('New conversation').first()).toBeVisible({ timeout: 20000 })
  })

  test('communication rail shows fixed inbox block and customizable sections', async ({ page }) => {
    await loginDashboard(page)
    await page.goto('/communication/inbox/all')
    await expect(page.getByRole('link', { name: 'New conversation' }).first()).toBeVisible({ timeout: 20000 })
    await expect(page.getByRole('link', { name: 'Unassigned' }).first()).toBeVisible({ timeout: 20000 })
    await expect(page.getByRole('button', { name: 'Departments' }).first()).toBeVisible({ timeout: 20000 })
    await expect(page.getByRole('link', { name: 'Contacts' }).first()).toBeVisible({ timeout: 20000 })
  })

  test('customize dialog hides a section and persists across reload', async ({ page }) => {
    await loginDashboard(page)
    await page.goto('/communication/inbox/all')
    await page.getByTestId('customize-sidebar').click()
    await expect(page.getByRole('heading', { name: 'Customize sidebar' })).toBeVisible({ timeout: 20000 })
    const teamsRow = page.locator('[data-editor-row="teams"]')
    await teamsRow.getByRole('button', { name: 'Hide' }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Departments' }).first()).toBeHidden({ timeout: 20000 })
    await page.reload()
    await expect(page.getByRole('link', { name: 'Contacts' }).first()).toBeVisible({ timeout: 20000 })
    await expect(page.getByRole('button', { name: 'Departments' }).first()).toBeHidden({ timeout: 20000 })
  })

  test('new conversation surface shows the default company agent', async ({ page }) => {
    await loginDashboard(page)
    await page.goto('/communication/new')
    await expect(page.getByText(/Front desk|Assistant|Company agent/).first()).toBeVisible({
      timeout: 20000,
    })
  })

  test('cockpit page renders stats', async ({ page }) => {
    await loginDashboard(page)
    await page.goto('/overview')
    await expect(page).toHaveURL(/\/cockpit/, { timeout: 20000 })
    // The Overview header is titled with the workspace name; the greeting and
    // date sit in its subtitle. Any visible page heading proves the render.
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 20000 })
    await expect(page.getByRole('link', { name: /^(Overview|Overzicht)$/i }).first()).toBeVisible({
      timeout: 20000,
    })
  })

  test('legacy chat, messages and inbox routes redirect into the communication hub', async ({ page }) => {
    await loginDashboard(page)
    await page.goto('/chat')
    await expect(page).toHaveURL(/\/communication\/new/, { timeout: 20000 })
    await page.goto('/messages')
    await expect(page).toHaveURL(/\/communication\/inbox\//, { timeout: 20000 })
    await page.goto('/sessions')
    await expect(page).toHaveURL(/\/communication\/new/, { timeout: 20000 })
    await page.goto('/inbox/customers/all')
    await expect(page).toHaveURL(/\/communication\/inbox\//, { timeout: 20000 })
    await page.goto('/communication/direct/my')
    await expect(page).toHaveURL(/\/communication\/new/, { timeout: 20000 })
    await page.goto('/communication/customers/my')
    await expect(page).toHaveURL(/\/communication\/inbox\/for_you/, { timeout: 20000 })
    await page.goto('/communication/agents/awaiting-decision')
    await expect(page).toHaveURL(/\/communication\/inbox\/for_you/, { timeout: 20000 })
  })

  test('legacy routes redirect to new nav', async ({ page }) => {
    await loginDashboard(page)
    await page.goto('/home')
    await expect(page).toHaveURL(/\/cockpit/, { timeout: 20000 })
    await page.goto('/os')
    await expect(page).toHaveURL(/\/agents/, { timeout: 20000 })
    await page.goto('/automations')
    await expect(page).toHaveURL(/\/agenda/, { timeout: 20000 })
    await page.goto('/triggers')
    await expect(page).toHaveURL(/\/agenda/, { timeout: 20000 })
    await page.goto('/communication')
    await expect(page).toHaveURL(/\/communication\/inbox\//, { timeout: 20000 })
    await page.goto('/govern')
    await expect(page).toHaveURL(/\/settings\/govern/, { timeout: 20000 })
    await page.goto('/os/docs')
    await expect(page).toHaveURL(/\/knowledge/, { timeout: 20000 })
  })

  test('legacy decisions route lands in For you and the seeded rule is open', async ({ page }) => {
    await loginDashboard(page)
    await page.goto('/communication/decisions')
    await expect(page).toHaveURL(/\/communication\/inbox\/for_you/, { timeout: 20000 })
    const payload = await page.evaluate(async () => {
      const token = sessionStorage.getItem('bokito_access_token_session')
      const res = await fetch('/api/notifications/decisions/groups', {
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) return { ok: false, status: res.status, body: '' }
      return { ok: true, status: res.status, body: await res.text() }
    })
    expect(payload.ok, `decision groups ${payload.status}`).toBe(true)
    expect(payload.body).toMatch(/Auto-close mail from|automatisch sluiten|Nieuwsbrief leverancier/i)
  })

  test('inbox all queue lists seeded external thread', async ({ page }) => {
    await loginDashboard(page)
    await page.goto('/communication/inbox/all')
    await expect(page.getByText(/facturatie|invoice|Vraag/i).first()).toBeVisible({ timeout: 60000 })
  })

  test('contacts page renders contact list', async ({ page }) => {
    await loginDashboard(page)
    await page.goto('/contacts')
    await expect(page.getByRole('heading', { name: 'Contacts' })).toBeVisible({ timeout: 20000 })
  })

  test('autonomy settings section renders govern content', async ({ page }) => {
    await loginDashboard(page)
    await page.goto('/settings/autonomy')
    await expect(page).toHaveURL(/\/settings\/govern/, { timeout: 20000 })
    await expect(page.getByRole('heading', { name: 'Govern' })).toBeVisible({ timeout: 20000 })
  })

  test('settings assistant page renders personal memory', async ({ page }) => {
    await loginDashboard(page)
    await page.goto('/settings/assistant')
    await expect(page).toHaveURL(/\/settings\/assistant/, { timeout: 20000 })
    await expect(page.getByRole('heading', { name: 'What Bokito remembers' })).toBeVisible({ timeout: 20000 })
  })

  test('agents page renders agents library', async ({ page }) => {
    await loginDashboard(page)
    await page.goto('/agents')
    await expect(page.getByRole('heading', { name: 'Agents' })).toBeVisible({ timeout: 20000 })
  })

  test('skills route redirects into knowledge', async ({ page }) => {
    await loginDashboard(page)
    await page.goto('/skills')
    await expect(page).toHaveURL(/\/knowledge/, { timeout: 20000 })
    await expect(page.getByRole('heading', { name: 'Knowledge', exact: true })).toBeVisible({ timeout: 20000 })
  })

  test('knowledge docs page renders', async ({ page }) => {
    await loginDashboard(page)
    await page.goto('/workspace')
    await expect(page).toHaveURL(/\/knowledge/, { timeout: 20000 })
    await expect(page.getByRole('heading', { name: 'Knowledge', exact: true })).toBeVisible({ timeout: 20000 })
  })

  test('agenda page renders the calendar views', async ({ page }) => {
    await loginDashboard(page)
    await page.goto('/agenda')
    // Agenda is full-bleed: the title sits in the topbar; the view switcher
    // (Day / Week / Month / List) and the New menu prove the page rendered.
    await expect(page.getByRole('tab', { name: /^(Week)$/i })).toBeVisible({ timeout: 20000 })
    await page.getByRole('tab', { name: /^(Week)$/i }).click()
    await expect(page.getByRole('tab', { name: /^(List|Lijst)$/i })).toBeVisible({ timeout: 20000 })
    await expect(page.getByRole('button', { name: /^(New|Nieuw)$/i })).toBeVisible({ timeout: 20000 })
  })

  test('integrations settings section loads', async ({ page }) => {
    await loginDashboard(page)
    await page.goto('/integrations/connected')
    await expect(page).toHaveURL(/\/connections/, { timeout: 20000 })
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 20000 })
  })
})
