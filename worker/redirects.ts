// One address per page. Cloudflare's static assets answer /about/ and
// /about.html with a temporary (307) redirect to /about; search engines
// should see a permanent one, so those addresses run the Worker first
// (wrangler.toml) and get a 301 here.

/** The page's canonical address, or null when the address is already it. */
export function canonicalPath(pathname: string): string | null {
  // One leading slash only: browsers read "//host" and "/\\host" as another
  // site, so a Location starting that way would send visitors off VoteStack.
  let path = `/${pathname.replace(/^[/\\]+/, '')}`
  if (path.endsWith('/index.html')) path = path.slice(0, -'index.html'.length)
  else if (path.endsWith('.html')) path = path.slice(0, -'.html'.length)
  if (path.length > 1) path = path.replace(/\/+$/, '') || '/'
  return path === pathname ? null : path
}

/** A 301 to the canonical address, keeping the query, or null. */
export function canonicalRedirect(request: Request): Response | null {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null
  const url = new URL(request.url)
  const path = canonicalPath(url.pathname)
  if (path === null) return null
  return new Response(null, {
    status: 301,
    headers: { Location: path + url.search },
  })
}
