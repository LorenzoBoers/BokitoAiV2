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

  // Seeded e2e tenants skip the wizard; if a run still lands here, complete it
  // via the API so the rest of the suite can use the app shell.
  if (page.url().includes('/onboarding')) {
    await page.evaluate(async () => {
      const token = sessionStorage.getItem('bokito_access_token_session')
      if (!token) return
      await fetch('/api/app/onboarding/wizard', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ complete: true }),
      })
    })
    await page.goto('/communication/inbox/open')
    await page.waitForURL((url) => !url.pathname.startsWith('/onboarding'), { timeout: 30000 })
  }
}
