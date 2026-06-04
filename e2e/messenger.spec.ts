import { test, expect } from '@playwright/test'
import { TEST_EMAIL, TEST_PASSWORD } from './helpers'

test('messenger login and assistant shell', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(TEST_EMAIL)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible({ timeout: 30000 })
})
