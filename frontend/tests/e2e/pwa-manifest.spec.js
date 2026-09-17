import { test, expect } from '@playwright/test'

// Bug 3 (installation compatibility) — validates the manifest fields
// Chromium's installability check and iOS's Add-to-Home-Screen both read.
// Pure HTTP fetch, no app interaction, so it runs identically on every
// project without needing location/network mocking.
test.describe('manifest.json', () => {
  let manifest

  test.beforeAll(async ({ request }) => {
    const res = await request.get('/manifest.json')
    expect(res.ok()).toBeTruthy()
    manifest = await res.json()
  })

  test('has the required installability fields', async () => {
    expect(manifest.name).toBeTruthy()
    expect(manifest.short_name).toBeTruthy()
    expect(manifest.short_name.length).toBeLessThanOrEqual(12) // Android home-screen label truncates hard past this
    expect(manifest.id).toBeTruthy()
    expect(manifest.start_url).toBeTruthy()
    expect(manifest.scope).toBeTruthy()
    expect(['standalone', 'minimal-ui', 'fullscreen']).toContain(manifest.display)
    expect(manifest.background_color).toMatch(/^#[0-9a-fA-F]{6}$/)
    expect(manifest.theme_color).toMatch(/^#[0-9a-fA-F]{6}$/)
  })

  test('start_url is within scope', async () => {
    // A start_url outside scope silently fails Chromium's installability
    // check with no error surfaced to the user.
    expect(manifest.start_url.startsWith(manifest.scope) || manifest.scope === '/').toBeTruthy()
  })

  test('carries a 192 and a 512 icon, plus a maskable one', async () => {
    const sizes = manifest.icons.map(i => i.sizes)
    expect(sizes).toContain('192x192')
    expect(sizes).toContain('512x512')
    const maskable = manifest.icons.find(i => (i.purpose || '').includes('maskable'))
    expect(maskable, 'no icon declares purpose:maskable — Android will letterbox the launcher icon').toBeTruthy()
    expect(maskable.sizes).toBe('512x512')
  })

  test('every declared icon actually resolves', async ({ request }) => {
    for (const icon of manifest.icons) {
      const res = await request.get(icon.src)
      expect(res.ok(), `${icon.src} (${icon.sizes}) returned ${res.status()}`).toBeTruthy()
    }
  })

  test('screenshots referenced in the manifest resolve (richer install UI)', async ({ request }) => {
    for (const shot of manifest.screenshots || []) {
      const res = await request.get(shot.src)
      expect(res.ok(), `${shot.src} returned ${res.status()}`).toBeTruthy()
    }
    // Chromium's richer install UI wants both a "wide" (desktop) and a
    // "narrow" (mobile) screenshot to show the fuller mini-info UI; this repo
    // currently only ships one "wide" entry — flagged in the audit report,
    // not treated as a hard failure here since it's an enhancement, not a
    // requirement.
  })
})

test.describe('apple-touch-icon / iOS install assets', () => {
  test('180x180 apple-touch-icon resolves', async ({ request }) => {
    const res = await request.get('/apple-touch-icon.png')
    expect(res.ok()).toBeTruthy()
  })
})

test.describe('service worker', () => {
  test('sw.js is served from the root (scope must cover start_url)', async ({ request }) => {
    const res = await request.get('/sw.js')
    expect(res.ok()).toBeTruthy()
    const body = await res.text()
    expect(body).toContain('skipWaiting')
  })

  test('registers without throwing and reaches "activated"', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'Playwright WebKit SW support is flaky under CI; verify on a real Safari instead')
    await page.goto('/')
    const state = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready
      return reg.active?.state ?? 'no-active-worker'
    })
    expect(state).toBe('activated')
  })
})
