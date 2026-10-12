// Cached downloads for the campaign money import. Bulk files are large (ISBE's
// receipts file is about 1 GB), so they stream to disk and are reused until
// they're older than maxAgeHours.

import { createWriteStream } from 'node:fs'
import { mkdir, rename, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream } from 'node:stream/web'

const USER_AGENT = 'VoteStack data import (votestack.org)'

/** Pause between downloads from the same publisher. */
const PAUSE_MS = 2000

/** Downloads url to path unless a fresh copy is already there. Returns true if it downloaded. */
export async function cachedDownload(
  url: string,
  path: string,
  maxAgeHours: number,
): Promise<boolean> {
  const existing = await stat(path).catch(() => null)
  if (existing && Date.now() - existing.mtimeMs < maxAgeHours * 3_600_000)
    return false
  await mkdir(dirname(path), { recursive: true })
  console.log(`Downloading ${url}`)
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok || !res.body)
    throw new Error(`${res.status} ${res.statusText} for ${url}`)
  const partial = `${path}.partial`
  await pipeline(
    Readable.fromWeb(res.body as ReadableStream),
    createWriteStream(partial),
  )
  await rename(partial, path)
  await new Promise((r) => setTimeout(r, PAUSE_MS))
  return true
}
