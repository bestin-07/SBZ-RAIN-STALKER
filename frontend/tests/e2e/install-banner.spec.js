import { test, expect } from '@playwright/test'

// Bug 3 — the install nudge (InstallPrompt.jsx) must never show once the app
// is already installed (standalone), on any platform's definition of
// "standalone". iOS reports it via navigator.standalone; every other
// standalone-capable browser via the display-mode media feature.
test.describe('install banner suppression when already installed', () => {
  test('never appears when matchMedia reports display-mode: standalone', async ({ page }) => {
    await page.addInitScript(() => {
      const real = window.matchMedia.bind(window)
      window.matchMedia = (query) => {
        if (query.includes('display-mode: standalone')) {
          return { matches: true, media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }
        }
        return real(query)
      }
    })
    await page.goto('/')
    await page.waitForTimeout(2500) // InstallPrompt's own 2s reveal delay
    await expect(page.getByText(/Add to home screen|zum Startbildschirm/i)).toHaveCount(0)
  })

  test('never appears when navigator.standalone is true (iOS)', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window.navigator, 'standalone', { get: () => true, configurable: true })
    })
    await page.goto('/')
    await page.waitForTimeout(2500)
    await expect(page.getByText(/Add to home screen|zum Startbildschirm/i)).toHaveCount(0)
  })

  test('shows the nudge (once, dismissible) in an ordinary browser tab', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(2500)
    // Only Chromium fires beforeinstallprompt for a real "Install" button;
    // every other engine falls through to the platform-specific instruction
    // copy (isIOSSafari / isIOSOther / isAndroid / generic) — either way SOME
    // guidance should be visible, never a dead button. Default app language
    // is German (i18n.js: saved('lang','de')).
    const banner = page.getByText('Gemma Raus installieren')
    await expect(banner).toBeVisible()
    // Dismiss and reload: must not reappear (localStorage-backed "seen" flag).
    await page.locator('button:has-text("×")').first().click()
    await page.reload()
    await page.waitForTimeout(2500)
    await expect(page.getByText(/Add to home screen|zum Startbildschirm/i)).toHaveCount(0)
  })
})
