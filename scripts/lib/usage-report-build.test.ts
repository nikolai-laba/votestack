import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  coverage,
  fillTemplate,
  measuresScript,
  parseReleases,
  readCosts,
} from './usage-report-build.ts'

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8')

describe('fillTemplate', () => {
  it('keeps the v1 page exactly as the template with data filled in', async () => {
    const v1 = await read('./usage-report.html')
    const data = { a: '</script>$&', n: [1, 2] }
    const placeholder = /(["'])__USAGE_DATA__\1/
    expect(fillTemplate(v1, data)).toBe(
      v1.replace(placeholder, () =>
        JSON.stringify(data).replace(/</g, '\\u003c'),
      ),
    )
  })

  it('throws when a placeholder is missing', () => {
    expect(() => fillTemplate('<p>none</p>', {})).toThrow(/data placeholder/)
    expect(() => fillTemplate("const D = '__USAGE_DATA__'", {}, 'x')).toThrow(
      /measures placeholder/,
    )
  })

  it('inlines the measures script and keeps it from closing the tag', () => {
    const html = fillTemplate(
      `const D = "__USAGE_DATA__"; '__USAGE_MEASURES__'`,
      {},
      'var s = "</script>$&"',
    )
    expect(html).toContain('var s = "<\\/script>$&"')
    expect(html).not.toContain('__USAGE')
  })
})

describe('parseReleases', () => {
  it('reads release dates and first notes, skipping Unreleased', async () => {
    const releases = parseReleases(
      await readFile(join(process.cwd(), 'CHANGELOG.md'), 'utf8'),
    )
    const r151 = releases.find((r) => r.version === '1.5.1')
    expect(r151).toMatchObject({ version: '1.5.1', date: '2026-10-23' })
    expect(r151?.note.startsWith('Profiles for offices')).toBe(true)
    expect(releases.some((r) => r.version === 'Unreleased')).toBe(false)
    expect(releases[releases.indexOf(r151!) + 1].version).toBe('1.5.0')
  })
})

describe('readCosts', () => {
  it('returns null for a missing, unreadable or wrong-shaped file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'costs-'))
    expect(await readCosts(join(dir, 'none.json'))).toBeNull()
    for (const [name, body] of [
      ['bad.json', '{nope'],
      ['shape.json', '{"monthly":[{"name":"x","usd":"5","from":"2026-10"}]}'],
      ['date.json', '{"monthly":[{"name":"x","usd":5,"from":"Oct"}]}'],
    ]) {
      await writeFile(join(dir, name), body)
      expect(await readCosts(join(dir, name))).toBeNull()
    }
  })

  it('reads a valid file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'costs-'))
    const good = {
      monthly: [{ name: 'Workers', usd: 5, from: '2026-10', to: '2026-12' }],
    }
    await writeFile(join(dir, 'ok.json'), JSON.stringify(good))
    expect(await readCosts(join(dir, 'ok.json'))).toEqual(good)
  })
})

describe('coverage', () => {
  it('counts candidates, races and areas across the contest files', () => {
    const file = (areaPath: string, names: string[][]) => ({
      areaPath,
      races: names.map((c) => ({ candidates: c.map((name) => ({ name })) })),
    })
    expect(
      coverage([
        file('il/cook', [['Ann Lee', 'Bo Chan'], []]),
        file('ca/los-angeles', [['ann lee']]),
      ]),
    ).toEqual({ candidates: 2, races: 3, areas: 2 })
  })
})

describe('measuresScript', () => {
  it('compiles the measures module into a plain script', async () => {
    const src = await read('./usage-measures.ts')
    const js = measuresScript(src)
    expect(js).not.toMatch(/^export /m)
    expect(new Function(js + '; return typeof northStar')()).toBe('function')
  })
})
