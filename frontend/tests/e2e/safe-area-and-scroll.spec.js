import { test, expect } from '@playwright/test'

// Bug 4 — safe-area insets. Playwright can't simulate a physical notch, so
// this only proves the CSS mechanism resolves to a sane value everywhere
// (the env()-with-fallback pattern) — actual notch/Dynamic Island clearance
// needs a real device (see the manual checklist in the audit report).
test('header row carries left/right safe-area padding with a sane fallback', async ({ page }) => {
  await page.goto('/')
  const header = page.locator('header > div').first()
  const padding = await header.evaluate(el => {
    const cs = getComputedStyle(el)
    return { left: parseFloat(cs.paddingLeft), right: parseFloat(cs.paddingRight) }
  })
  // env(safe-area-inset-*) resolves to 0 outside a real notched device, so
  // the fallback (1rem = 16px at default root font size) is what should show
  // up here — confirms pl-safe/pr-safe are actually applied and not silently
  // falling through to 0.
  expect(padding.left).toBeGreaterThanOrEqual(16)
  expect(padding.right).toBeGreaterThanOrEqual(16)
})

// Bug 1 — pull-to-refresh vs. native overscroll. The app's own custom
// pull-to-refresh (App.jsx) needs the native browser pull gesture contained,
// or a drag inside the ribbon/map can trigger the OS-level pull-to-refresh
// underneath the app's own handler.
test.describe('overscroll containment', () => {
  test('body blocks the native vertical rubber-band', async ({ page }) => {
    await page.goto('/')
    const value = await page.evaluate(() => getComputedStyle(document.body).overscrollBehaviorY)
    expect(value).toBe('none')
  })

  test('the app shell and inner scroll column contain overscroll (no chaining to the page)', async ({ page }) => {
    await page.goto('/')
    const values = await page.evaluate(() => {
      const root = document.querySelector('.overflow-y-auto.overscroll-y-contain')
      return root ? getComputedStyle(root).overscrollBehaviorY : null
    })
    expect(values).toBe('contain')
  })
})
