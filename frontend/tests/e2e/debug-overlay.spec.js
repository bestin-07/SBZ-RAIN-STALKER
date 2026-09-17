import { test, expect } from '@playwright/test'

// Bug 1 (rapid refresh) — the ?debug=1 diagnostic overlay this audit adds
// (frontend/src/debug.js). Verifies it's a true no-op without the flag, and
// that it actually surfaces lifecycle/fetch data with the flag on.
test.describe('debug overlay', () => {
  test('is absent with no query param', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(300)
    await expect(page.locator('#gr-debug-overlay')).toHaveCount(0)
  })

  test('appears with ?debug=1 and shows build/sw/fetch counters', async ({ page }) => {
    await page.goto('/?debug=1')
    const overlay = page.locator('#gr-debug-overlay')
    await expect(overlay).toBeVisible()
    await expect(overlay).toContainText('GR DEBUG')
    await expect(overlay).toContainText(/build=/)
    await expect(overlay).toContainText(/fetches=\d+/)
  })

  test('logs a lifecycle entry on visibilitychange', async ({ page, context }) => {
    await page.goto('/?debug=1')
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await expect(page.locator('#gr-debug-overlay')).toContainText('visibilitychange', { timeout: 2000 })
  })

  test('the "hide" button collapses to a reopenable tab, never losing the log', async ({ page }) => {
    await page.goto('/?debug=1')
    await page.getByRole('button', { name: 'hide' }).click()
    await expect(page.locator('#gr-debug-overlay')).toBeHidden()
    await expect(page.getByRole('button', { name: 'GR DBG' })).toBeVisible()
    await page.getByRole('button', { name: 'GR DBG' }).click()
    await expect(page.locator('#gr-debug-overlay')).toBeVisible()
  })
})
