// TRANSLATION STRUCTURE GUARD.
//
// i18n.js is one big object literal per language, and a duplicate key in an object
// literal is NOT an error in JavaScript — the last one silently wins. v2.30.0 added
// `src_radar: 'radar {mm} mm'` for the new source line without noticing that
// `src_radar: 'Radar'` already existed as the data-sources label in the guide. The
// build passed, both suites passed, and the source line quietly rendered a bare
// "radar" with no reading in it. Nothing anywhere could have caught that except this.
import { describe, it, expect } from 'vitest'
import { translations } from './i18n'
import { readFileSync } from 'node:fs'

const SRC = readFileSync(new URL('./i18n.js', import.meta.url), 'utf8')

function keysOf(lang) {
  const start = SRC.indexOf(`  ${lang}: {`)
  const end = SRC.indexOf('\n  },', start)
  return [...SRC.slice(start, end).matchAll(/^ {4}([A-Za-z_][A-Za-z0-9_]*):/gm)].map(m => m[1])
}

describe('i18n structure', () => {
  for (const lang of ['de', 'en']) {
    it(`${lang} declares no key twice`, () => {
      const keys = keysOf(lang)
      const dupes = keys.filter((k, i) => keys.indexOf(k) !== i)
      expect([...new Set(dupes)]).toEqual([])
    })
  }

  it('both languages carry exactly the same keys', () => {
    // A string added to only one language falls through to the raw key on screen.
    const de = Object.keys(translations.de), en = Object.keys(translations.en)
    expect(de.filter(k => !en.includes(k))).toEqual([])
    expect(en.filter(k => !de.includes(k))).toEqual([])
  })

  it('every placeholder in a German string exists in its English twin', () => {
    // A {mm} that survives in one language and is dropped in the other renders a
    // literal "{mm}" to half the users.
    const ph = v => [...String(Array.isArray(v) ? v.join(' ') : v).matchAll(/\{(\w+)\}/g)]
      .map(m => m[1]).sort()
    for (const k of Object.keys(translations.de)) {
      expect({ [k]: ph(translations.de[k]) }).toEqual({ [k]: ph(translations.en[k]) })
    }
  })
})
