// Downloads the official results files into
// data/raw/results/{ISO time, ':' as '-'}/ for npm run results:build:
//   chicago-summary.txt and chicago-summary.last-modified.txt (the
//   Last-Modified header), cook-results.html, la-results.json,
//   ca-sos/{api path, '/' as '__'}.json and retrieved-at.txt.
// The ca-sos paths come from the match files in content/results-inputs/, so
// before any exist only the three office files are fetched. Writes to a
// temporary folder and renames it at the end, so a failed download leaves no
// half-written folder; exits 1 naming each source that failed.
//
// Run: npm run results:fetch

import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CA_SOS_BASE, caSosPaths } from './lib/results/ca-sos.ts'
import { AREAS, DOWNLOADS, inputPath, rel } from './lib/results/files.ts'
import { parseMatchFile } from './lib/results/inputs.ts'
import { OFFICIAL_URLS } from './lib/results/types.ts'

const USER_AGENT = 'VoteStack results check (https://votestack.org)'

interface Download {
  /** What to call the source in a message. */
  label: string
  url: string
  /** The file to write, relative to the download folder. */
  file: string
  json?: boolean
  /** Also save this response header beside the file. */
  header?: { name: string; file: string }
}

/** The ca-sos paths of every area that has a match file; none when no area has one. */
async function caSosDownloads(): Promise<Download[]> {
  const paths = new Set<string>()
  let matches = 0
  for (const area of AREAS) {
    const file = inputPath(area, 'match')
    if (!existsSync(file)) continue
    matches++
    let match
    try {
      match = parseMatchFile(JSON.parse(await readFile(file, 'utf8')))
    } catch (err) {
      throw new Error(`${rel(file)}: ${(err as Error).message}`)
    }
    for (const p of caSosPaths(match)) paths.add(p)
  }
  if (matches === 0) {
    console.log(
      'No match files yet, so fetching only the three office files; the ca-sos paths come from the match files.',
    )
  }
  return [...paths].sort().map((path) => ({
    label: `ca-sos ${path}`,
    url: CA_SOS_BASE + path,
    file: join('ca-sos', `${path.replaceAll('/', '__')}.json`),
    json: true,
  }))
}

async function download(d: Download, folder: string): Promise<void> {
  const res = await fetch(d.url, {
    headers: { 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body = await res.text()
  if (body.trim() === '') throw new Error('empty response')
  if (d.json) {
    try {
      JSON.parse(body)
    } catch {
      throw new Error('not valid JSON')
    }
  }
  if (d.header) {
    const value = res.headers.get(d.header.name)
    if (!value) throw new Error(`no ${d.header.name} header`)
    await writeFile(join(folder, d.header.file), `${value}\n`)
  }
  await writeFile(join(folder, d.file), body)
}

async function main(): Promise<void> {
  const downloads: Download[] = [
    {
      label: 'chicago',
      url: OFFICIAL_URLS.chicago,
      file: 'chicago-summary.txt',
      header: {
        name: 'last-modified',
        file: 'chicago-summary.last-modified.txt',
      },
    },
    { label: 'cook', url: OFFICIAL_URLS.cook, file: 'cook-results.html' },
    {
      label: 'la',
      url: OFFICIAL_URLS.la,
      file: 'la-results.json',
      json: true,
    },
    ...(await caSosDownloads()),
  ]

  const retrievedAt = new Date().toISOString()
  const name = retrievedAt.replaceAll(':', '-')
  const temp = join(DOWNLOADS, `.tmp-${name}`)
  mkdirSync(join(temp, 'ca-sos'), { recursive: true })

  const outcomes = await Promise.allSettled(
    downloads.map((d) => download(d, temp)),
  )
  const failed = outcomes.flatMap((o, i) =>
    o.status === 'rejected'
      ? [
          `${downloads[i].label} (${downloads[i].url}): ${(o.reason as Error).message}`,
        ]
      : [],
  )
  if (failed.length > 0) {
    rmSync(temp, { recursive: true, force: true })
    for (const f of failed) console.error(`Failed: ${f}`)
    process.exitCode = 1
    return
  }

  await writeFile(join(temp, 'retrieved-at.txt'), `${retrievedAt}\n`)
  const final = join(DOWNLOADS, name)
  renameSync(temp, final)
  console.log(`Saved ${downloads.length} sources to ${rel(final)}/`)
  for (const d of downloads) console.log(`  ${d.label} -> ${d.file}`)
}

try {
  await main()
} catch (err) {
  console.error((err as Error).message)
  process.exitCode = 1
}
