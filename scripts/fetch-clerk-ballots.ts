// Downloads the Cook County Clerk's sample ballot for every suburban ballot
// style (one PDF per style; every precinct with that style has the same
// contests) and saves its text to data/raw/clerk-ballots/<style>.txt (and
// <style>.layout.txt: pdftotext's -layout reading, which breaks the ballot's
// columns in different places; scripts/lib/ballot-text.ts uses both). The
// ballot styles are the ground truth for districts the Clerk's per-precinct
// jurisdiction lists leave out, such as sanitary districts
// and for referenda and subcircuits where those lists or the maps are wrong
// (scripts/build-clerk-precincts.ts). Needs `pdftotext`.
//
// PDFs are cached in data/raw/sample-ballots/ (shared with the audit), so a
// rerun only downloads what's missing; pass --refresh to fetch every style
// again after the Clerk updates its ballots. Requests are spaced out to be
// gentle with the Clerk's server.
// Run after fetch-clerk-precincts.ts: node scripts/fetch-clerk-ballots.ts

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ClerkPrecinct } from './fetch-clerk-precincts.ts'
import { RAW, readJson } from './lib/data.ts'
import { ELECTION_CODE } from './lib/election.ts'

const PDF_DIR = join(RAW, 'sample-ballots')
const TEXT_DIR = join(RAW, 'clerk-ballots')
const DELAY_MS = 300
const refresh = process.argv.includes('--refresh')

// Ballot style → precincts with it.
const precinctsByStyle = new Map<string, string[]>()
const dir = join(RAW, 'clerk-precincts')
for (const file of (await readdir(dir)).sort()) {
  const raw = await readJson<ClerkPrecinct>(join(dir, file))
  for (const split of raw.splits) {
    for (const style of split.styles) {
      const list = precinctsByStyle.get(style) ?? []
      list.push(raw.precinct.slice('cook:'.length))
      precinctsByStyle.set(style, list)
    }
  }
}

await mkdir(PDF_DIR, { recursive: true })
await mkdir(TEXT_DIR, { recursive: true })
let fetched = 0
const failed: string[] = []
for (const [style, precincts] of precinctsByStyle) {
  const text = join(TEXT_DIR, `${style}.txt`)
  const layout = join(TEXT_DIR, `${style}.layout.txt`)
  if (existsSync(text) && existsSync(layout) && !refresh) continue
  // The English/Spanish ballot, named like the Clerk's sample ballot list
  // (GetSampleBallotList's BallotName): 1_<precinct>_<style>_AB_SP.pdf.
  const names = precincts.map((p) => `1_${p}_${style}_AB_SP.pdf`)
  let name = refresh
    ? undefined
    : names.find((n) => existsSync(join(PDF_DIR, n)))
  if (!name) {
    name = names[0]
    const url = `https://sampleballot.cookcountyclerkil.gov/${ELECTION_CODE}/${name}`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'VoteStack data import (votestack.org)' },
    })
    await new Promise((r) => setTimeout(r, DELAY_MS))
    if (!res.ok) {
      failed.push(`${style} (${res.status})`)
      continue
    }
    await writeFile(join(PDF_DIR, name), Buffer.from(await res.arrayBuffer()))
    fetched++
  }
  const pdf = join(PDF_DIR, name)
  await writeFile(
    text,
    execFileSync('pdftotext', [pdf, '-'], { encoding: 'utf8' }),
  )
  await writeFile(
    layout,
    execFileSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8' }),
  )
}
console.log(
  `${precinctsByStyle.size} ballot styles, ${fetched} sample ballots downloaded`,
)
if (failed.length) {
  // A style without text keeps the map for the layers it would settle.
  console.log(`No sample ballot for ${failed.length}: ${failed.join(', ')}`)
}
