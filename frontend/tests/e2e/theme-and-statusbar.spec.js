import { test, expect } from '@playwright/test'

// Bug 4 (status bar / theme) — the meta tags Android reads for the status-bar
// colour, and the color-scheme the UA uses for native form controls, must
// track BOTH the system preference on first load and the in-app toggle
// afterwards. This runs against the LocationPrompt screen (no GPS/network
// needed — Header renders unconditionally per App.jsx).
test.describe('theme-color / color-scheme sync', () => {
  test('matches the app default (light) on first load, no system preference set', async ({ page }) => {
    await page.goto('/')
    const content = await page.locator('meta[name="theme-color"]').getAttribute('content')
    const scheme = await page.locator('meta[name="color-scheme"]').getAttribute('content')
    // index.html's own comment: must equal the CURRENT app default, not
    // merely "a supported value" — a value here that isn't actually on
    // screen makes Android compute status-bar icon contrast against the
    // wrong background and the icons vanish.
    expect(content).toBe('#F2F0EB')
    expect(scheme).toBe('light')
    // index.css's dark-by-default :root + a toggled `html.light` class is the
    // actual mechanism (App.jsx: classList.toggle('light', theme==='light'))
    // — there is no 'dark' class, ever. Default theme is 'light' (App.jsx),
    // so the class must be present from first paint.
    await expect(page.locator('html')).toHaveClass(/light/)
  })

  test('toggling the in-app theme updates theme-color, color-scheme and the html class together', async ({ page }) => {
    await page.goto('/')
    const themeBtn = page.getByRole('button', { name: 'toggle theme' })
    await themeBtn.click()

    const contentAfter = await page.locator('meta[name="theme-color"]').getAttribute('content')
    const schemeAfter = await page.locator('meta[name="color-scheme"]').getAttribute('content')
    // Whichever direction it toggled, all three signals must agree with each
    // other — this is exactly the v2.33/v2.34 bug class (status-bar icons
    // computed against a theme-color that wasn't actually on screen).
    const isDark = contentAfter !== '#F2F0EB'
    expect(schemeAfter).toBe(isDark ? 'dark' : 'light')
    if (isDark) await expect(page.locator('html')).not.toHaveClass(/light/)
    else await expect(page.locator('html')).toHaveClass(/light/)
  })

  test('persists the toggled theme across a reload (localStorage)', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'toggle theme' }).click()
    const contentBefore = await page.locator('meta[name="theme-color"]').getAttribute('content')
    await page.reload()
    const contentAfter = await page.locator('meta[name="theme-color"]').getAttribute('content')
    expect(contentAfter).toBe(contentBefore)
  })
})

test.describe('color-scheme follows OS preference on a fresh (no localStorage) load', () => {
  test('OS dark preference does not force the app dark by itself', async ({ browser }) => {
    // The app has its OWN light/dark toggle independent of the OS — index.css's
    // whole point (see its top-of-file comment) is that `color-scheme` must
    // name the scheme actually IN USE, not silently follow the OS. This
    // guards against that regression: emulating an OS dark preference with no
    // stored choice must not flip the rendered theme.
    const ctx = await browser.newContext({ colorScheme: 'dark' })
    const page = await ctx.newPage()
    await page.goto('/')
    const content = await page.locator('meta[name="theme-color"]').getAttribute('content')
    expect(content).toBe('#F2F0EB')
    await ctx.close()
  })
})
