import { test, expect } from '@playwright/test'

// Bug 2 (animation) — prefers-reduced-motion must actually neutralise every
// looping/sustained animation the app ships. Rather than driving the app
// into the specific states that trigger each one (which needs mocked GPS +
// weather data for some), this asserts directly against the CSS rules in
// index.css by attaching elements with the same classes the app uses — a
// true unit test of the stylesheet contract, immune to app-data flakiness.
test.describe('prefers-reduced-motion: reduce', () => {
  test.use({ reducedMotion: 'reduce' })

  test('Tailwind animate-spin (relocate-button spinner) is neutralised', async ({ page }) => {
    await page.goto('/')
    const name = await page.evaluate(() => {
      const el = document.createElement('div')
      el.className = 'animate-spin'
      document.body.appendChild(el)
      const n = getComputedStyle(el).animationName
      el.remove()
      return n
    })
    expect(name).toBe('none')
  })

  test('the ribbon mist marker (.gr-mist) is neutralised', async ({ page }) => {
    await page.goto('/')
    const name = await page.evaluate(() => {
      const el = document.createElement('div')
      el.className = 'gr-mist'
      document.body.appendChild(el)
      const n = getComputedStyle(el).animationName
      el.remove()
      return n
    })
    expect(name).toBe('none')
  })
})

test.describe('no motion preference (baseline — animations should actually run)', () => {
  test.use({ reducedMotion: 'no-preference' })

  test('animate-spin plays when the user has not asked to reduce motion', async ({ page }) => {
    await page.goto('/')
    const name = await page.evaluate(() => {
      const el = document.createElement('div')
      el.className = 'animate-spin'
      document.body.appendChild(el)
      const n = getComputedStyle(el).animationName
      el.remove()
      return n
    })
    // Guards the guard: if this ever reads 'none' too, the reduced-motion
    // test above would be passing for the wrong reason (no animation to
    // begin with, in either mode).
    expect(name).not.toBe('none')
  })
})
