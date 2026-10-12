// Checks the colour tokens in index.css against WCAG contrast minimums
// 4.5:1 for text pairs, 3:1 for field and focus.
// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Read as text: Vitest blanks CSS imports.
const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')

function tokens(block: string): Record<string, string> {
  return Object.fromEntries(
    [...block.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6});/gi)].map((m) => [
      m[1],
      m[2],
    ]),
  )
}

/** The declarations of the first rule whose selector starts at `marker`. */
function block(marker: string): string {
  const start = css.indexOf(marker)
  if (start < 0) throw new Error(`index.css has no ${marker}`)
  const open = css.indexOf('{', start)
  return css.slice(open + 1, css.indexOf('}', open))
}

const light = tokens(block(':root {'))
// The dark values live in two blocks: the menu's explicit choice and the
// device setting.
const chosenDark = block(":root:where([data-theme='dark'])")
const deviceDark = block(":root:where(:not([data-theme='light']))")
const dark = tokens(chosenDark)

describe('dark token blocks', () => {
  it('match each other, colour scheme included', () => {
    const decls = (b: string) =>
      b
        .split(';')
        .map((d) => d.trim())
        .filter(Boolean)
    expect(Object.keys(dark).length).toBeGreaterThan(10)
    expect(decls(deviceDark)).toEqual(decls(chosenDark))
    expect(decls(chosenDark)).toContain('color-scheme: dark')
  })

  it('cover every light token', () => {
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort())
  })

  it('apply the device setting only inside its media query', () => {
    expect(css).toMatch(
      /@media \(prefers-color-scheme: dark\) \{\s*:root:where\(:not\(\[data-theme='light'\]\)\) \{/,
    )
  })
})

const lum = (hex: string) => {
  const c = [0, 2, 4]
    .map((i) => parseInt(hex.slice(1 + i, 3 + i), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const PAIRS: [string, string, number][] = [
  ['text', 'bg', 4.5],
  ['text', 'surface', 4.5],
  ['text', 'band', 4.5],
  ['muted', 'bg', 4.5],
  ['muted', 'surface', 4.5],
  // Links, and the picked names and Yes/No answers on Saved choices (page bg).
  ['primary', 'bg', 4.5],
  ['primary', 'surface', 4.5],
  ['on-primary', 'primary', 4.5],
  ['on-highlight', 'highlight', 4.5],
  // A picked name on Saved choices.
  ['on-pick', 'pick', 4.5],
  ['warn-fg', 'warn-bg', 4.5],
  ['danger', 'bg', 4.5],
  ['danger', 'surface', 4.5],
  ['success', 'bg', 4.5],
  ['field', 'surface', 3],
  ['field', 'bg', 3],
  ['focus', 'bg', 3],
  ['focus', 'surface', 3],
  // Pairs that meet inside components: the current section and menu page
  // (highlight), links in amber notices, the contest band.
  ['muted', 'highlight', 4.5],
  ['muted', 'band', 4.5],
  ['muted', 'warn-bg', 4.5],
  ['focus', 'highlight', 3],
  ['focus', 'warn-bg', 3],
  ['focus', 'band', 3],
  ['warn-line', 'warn-bg', 3],
]

describe.each([
  ['light', light],
  ['dark', dark],
])('%s tokens', (_, t) => {
  it.each(PAIRS)('%s on %s meets %s:1', (fg, bg, min) => {
    expect(t[fg], `missing --${fg}`).toBeDefined()
    expect(t[bg], `missing --${bg}`).toBeDefined()
    expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(min)
  })
})
