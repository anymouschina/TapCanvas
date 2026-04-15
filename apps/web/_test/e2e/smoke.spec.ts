import { expect, test } from '@playwright/test'

test('app shell renders', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/TapCanvas/i)
  await expect(page.locator('#root')).toBeVisible()
})
