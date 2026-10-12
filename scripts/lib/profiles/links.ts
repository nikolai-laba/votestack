// Opens cited links politely for the profile checks: a few at a
// time, one at a time per site, with a cache in data/build/profiles/ so a
// rerun only opens new or old links.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { readJson, writeJson } from '../data.ts'
import { PIPELINE_BUILD } from './content.ts'
import { detectGate, type LinkResult } from './race-checks.ts'

const CACHE = join(PIPELINE_BUILD, 'link-cache.json')
/** Reuse a successful result this long; failures are always retried. */
const CACHE_HOURS = 72
const TIMEOUT_MS = 20_000
/** Enough of the page to find a login or paywall notice. */
const READ_BYTES = 200_000

async function readStart(res: Response): Promise<string> {
  if (!res.body) return ''
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  while (text.length < READ_BYTES) {
    const { done, value } = await reader.read()
    if (done) break
    text += decoder.decode(value, { stream: true })
  }
  await reader.cancel().catch(() => {})
  return text
}

export async function openLink(url: string): Promise<LinkResult> {
  const checkedAt = new Date().toISOString()
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; VoteStack link check)',
        accept:
          'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8',
      },
    })
    const type = res.headers.get('content-type') ?? ''
    const html = res.ok && type.includes('html') ? await readStart(res) : ''
    if (!html) await res.body?.cancel().catch(() => {})
    return {
      url,
      status: res.status,
      finalUrl: res.url,
      gate: res.ok ? detectGate(res.url, html) : undefined,
      checkedAt,
    }
  } catch {
    return { url, status: 'error', checkedAt }
  }
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

/**
 * Opens every URL (cached ones excepted) with at most `concurrency` requests
 * in flight and one per host, and returns results for all of them.
 */
export async function checkUrls(
  urls: string[],
  { concurrency = 6, refresh = false } = {},
): Promise<Map<string, LinkResult>> {
  const cache: Record<string, LinkResult> = existsSync(CACHE)
    ? await readJson<Record<string, LinkResult>>(CACHE)
    : {}
  const fresh = (r: LinkResult | undefined) =>
    !refresh &&
    r &&
    typeof r.status === 'number' &&
    r.status >= 200 &&
    r.status < 300 &&
    Date.now() - Date.parse(r.checkedAt) < CACHE_HOURS * 3600_000
  const unique = [...new Set(urls)]
  const todo = unique.filter((u) => !fresh(cache[u]))

  const busyHosts = new Set<string>()
  const queue = [...todo]
  let done = 0
  async function worker() {
    while (queue.length > 0) {
      const index = queue.findIndex((u) => !busyHosts.has(hostOf(u)))
      if (index < 0) {
        await new Promise((r) => setTimeout(r, 100))
        continue
      }
      const [url] = queue.splice(index, 1)
      const host = hostOf(url)
      busyHosts.add(host)
      try {
        cache[url] = await openLink(url)
      } finally {
        busyHosts.delete(host)
      }
      done++
      if (done % 25 === 0) console.log(`  ${done}/${todo.length} links opened`)
    }
  }
  if (todo.length > 0) {
    console.log(
      `Opening ${todo.length} links (${unique.length - todo.length} cached)`,
    )
    await Promise.all(Array.from({ length: concurrency }, worker))
    await writeJson(CACHE, cache)
  }
  return new Map(urls.map((u) => [u, cache[u]]))
}
