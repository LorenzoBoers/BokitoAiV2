import type { Page } from '@playwright/test'

export const TEST_EMAIL = 'admin@bokito.ai'
export const TEST_PASSWORD = 'bokito-test-password'

export async function loginDashboard(page: Page) {
  await page.goto('/login')
  await page.locator('#email').fill(TEST_EMAIL)
  await page.locator('#password').fill(TEST_PASSWORD)
  // Exact match: the login page also has a "Sign in with Microsoft" button.
  await page.getByRole('button', { name: /^(Sign in|Inloggen)$/i }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30000 })
}
