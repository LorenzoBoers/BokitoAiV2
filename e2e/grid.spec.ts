import { test, expect, type Page } from '@playwright/test'
import { loginDashboard } from './helpers'

async function firstAgentNode(page: Page, scope: string) {
  const node = page.locator(`${scope} [data-testid="grid-node"][data-node-id^="agent:"]`).first()
  await expect(node).toBeVisible({ timeout: 20000 })
  return node
}

test.describe('Grid', () => {
  test('2D board opens the detail of a node', async ({ page }) => {
    await loginDashboard(page)
    await page.goto('/workforce/grid')
    const node = await firstAgentNode(page, '')
    await node.click()
    await expect(page.getByTestId('grid-detail')).toBeVisible()
  })

  test('3D scene opens the same detail', async ({ page }) => {
    await loginDashboard(page)
    await page.goto('/workforce/grid?view=3d')
    await expect(page.getByTestId('grid-3d')).toBeVisible({ timeout: 20000 })
    const node = await firstAgentNode(page, '[data-testid="grid-3d"]')
    await node.click()
    await expect(page.getByTestId('grid-detail')).toBeVisible()
  })

  test('Labels lens keeps the lens and an isolated label in the URL', async ({ page }) => {
    await loginDashboard(page)
    await page.goto('/workforce/grid')
    await firstAgentNode(page, '')
    await page.getByRole('radio', { name: 'Labels' }).click()
    await expect(page).toHaveURL(/lens=labels/)
    const chips = page.getByTestId('grid-label-chips').getByRole('button')
    if ((await chips.count()) > 0) {
      await chips.first().click()
      await expect(page).toHaveURL(/label=/)
    }
  })

  test('works-in link on a folder opens the add form', async ({ page }) => {
    await loginDashboard(page)
    const folderId = await page.evaluate(async () => {
      const token = sessionStorage.getItem('bokito_access_token_session')
      const res = await fetch('/api/folders', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
      })
      const body = await res.json()
      const rows = Array.isArray(body) ? body : body.items ?? body.folders ?? []
      return rows[0]?.id as string | undefined
    })
    test.skip(!folderId, 'workspace has no folder')
    await page.goto(`/folders/${folderId}#works-in-add`)
    const section = page.getByTestId('works-in-section')
    await expect(section).toBeVisible({ timeout: 20000 })
    await expect(section.getByRole('button', { name: /^(Cancel|Annuleren)$/ })).toBeVisible()
  })
})
