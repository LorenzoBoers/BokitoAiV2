import { test, expect } from '@playwright/test'

test('messenger login and chat', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Assistant')).toBeVisible({ timeout: 15000 })
})
