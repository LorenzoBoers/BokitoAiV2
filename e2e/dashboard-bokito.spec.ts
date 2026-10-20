import { test, expect } from '@playwright/test'
import { loginDashboard } from './helpers'

test.describe('Dashboard', () => {
  test('new conversation leaf is reachable from the communication hub', async ({ page }) => {
    await loginDashboard(page)
    await page.goto('/communication/new')
    await expect(page.getByText('New conversation').first()).toBeVisible({ timeout: 20000 })
  })

  test('main rail: New conversation once, Work and Team groups, Settings at the bottom', async ({ page }) => {
    await loginDashboard(page)
    for (const path of ['/communication/inbox/all', '/agents', '/settings']) {
      await page.goto(path)
      const work = page.locator('[data-tour="nav-group-work"]')
      const team = page.locator('[data-tour="nav-group-team"]')
      await expect(work).toBeVisible({ timeout: 20000 })
      await expect(work).toContainText('Work')
      await expect(team).toContainText('Team')
      for (const tab of ['communication', 'agenda', 'folders', 'workstreams']) {
        await expect(work.locator(`[data-tour="nav-${tab}"]`)).toBeVisible()
      }
      for (const tab of ['agents', 'team']) {
        await expect(team.locator(`[data-tour="nav-${tab}"]`)).toBeVisible()
      }
      await expect(page.locator('[data-tour="nav-newChat"]')).toHaveCount(1)
      await expect(page.getByRole('link', { name: 'New conversation', exact: true })).toHaveCount(1)

      const settings = page.locator('[data-tour="nav-settings"]')
      await expect(settings).toHaveCount(1)
      await expect(work.locator('[data-tour="nav-settings"]')).toHaveCount(0)
      await expect(team.locator('[data-tour="nav-settings"]')).toHaveCount(0)
      const settingsBox = await settings.boundingBox()
      const teamBox = await team.boundingBox()
      expect(settingsBox && teamBox && settingsBox.y >= teamBox.y + teamBox.height).toBe(true)
    }
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

  test('overview and cockpit redirect into today in Communication', async ({ page }) => {
    await loginDashboard(page)
    await page.goto('/overview')
    await expect(page).toHaveURL(/\/communication\/today/, { timeout: 20000 })
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 20000 })
    await page.goto('/cockpit')
    await expect(page).toHaveURL(/\/communication\/today/, { timeout: 20000 })
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
    await expect(page).toHaveURL(/\/communication\/today/, { timeout: 20000 })
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
    await expect(page).toHaveURL(/\/agents\/knowledge/, { timeout: 20000 })
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

  test('why panel explains the open conversation', async ({ page }) => {
    await loginDashboard(page)
    await page.goto('/communication/inbox/all')
    await page.getByText(/facturatie|invoice|Vraag/i).first().click()
    await page.getByTestId('thread-why-toggle').click()
    const panel = page.getByTestId('thread-why-panel')
    await expect(panel).toBeVisible({ timeout: 20000 })
    await expect(panel.getByRole('listitem').first()).toBeVisible({ timeout: 20000 })
    await expect(panel.getByRole('link', { name: /Autonomy is/ }).first()).toBeVisible()
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
