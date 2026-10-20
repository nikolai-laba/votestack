// Build-time rendering of the site's pages to HTML, so search engines, link
// previews and readers on slow connections get each page's content before
// any JavaScript runs. Built with `vite build --ssr` and run by
// scripts/prerender.ts after the app's own build; it never ships to
// browsers. The app (main.tsx) then renders the same page over it, using
// the profile embedded in the page instead of fetching it again.

// Build-time only, never hot-reloaded, so it may export more than components.
/* oxlint-disable react/only-export-components */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { prerenderToNodeStream } from 'react-dom/static'
import {
  createStaticHandler,
  createStaticRouter,
  StaticRouterProvider,
} from 'react-router'
import {
  ABOUT_PATH,
  GET_STARTED_PATH,
  NOTIFY_PATH,
  SAVED_CHOICES_PATH,
  SUPPORT_PATH,
  profilePath,
  reportPath,
} from './ballot/profileLinks.ts'
import {
  ABOUT_HEAD,
  HOME_HEAD,
  RACES_HEAD,
  HOW_PROFILES_HEAD,
  NOT_FOUND_HEAD,
  NOTIFY_HEAD,
  SAVED_CHOICES_HEAD,
  SITE_URL,
  SUPPORT_HEAD,
  headHtml,
  profileHead,
  raceAreaHead,
  raceHead,
  reportHead,
  type PageHead,
} from './head.ts'
import { prerenderData, type PrerenderData } from './prerenderData.ts'
import {
  RACES_QUERY_KEY,
  loadRaces,
  publishedFor,
  type RaceData,
} from './races/data.ts'
import { routes } from './routes.tsx'
import type { CandidateProfile } from './shared/profile.ts'
import { RACES_PATH, racePath } from './shared/races.ts'

export { SITE_URL, headHtml, prerenderData }

export interface PrerenderPage {
  /** The page's address. */
  path: string
  /** Where the page goes in dist/: Cloudflare serves /about from about.html. */
  file: string
  head: PageHead
  /**
   * The address whose content fills the page, or undefined for an empty
   * shell that the app fills in the browser (pages that depend on what's
   * saved on the device, forms nobody should find through search, 404s).
   */
  render?: string
  data?: PrerenderData
}

/** Every page except the candidates'. */
export const STATIC_PAGES: PrerenderPage[] = [
  // `/` sends visitors with no ballot to the address form, so that's what
  // it shows before the app starts.
  { path: '/', file: 'index.html', head: HOME_HEAD, render: GET_STARTED_PATH },
  {
    path: GET_STARTED_PATH,
    file: 'getstarted.html',
    head: HOME_HEAD,
    render: GET_STARTED_PATH,
  },
  {
    path: ABOUT_PATH,
    file: 'about.html',
    head: ABOUT_HEAD,
    render: ABOUT_PATH,
    data: { page: 'about' },
  },
  {
    path: '/how-profiles-are-made',
    file: 'how-profiles-are-made.html',
    head: HOW_PROFILES_HEAD,
    render: '/how-profiles-are-made',
  },
  {
    path: SUPPORT_PATH,
    file: 'support.html',
    head: SUPPORT_HEAD,
    render: SUPPORT_PATH,
  },
  {
    path: NOTIFY_PATH,
    file: 'notify.html',
    head: NOTIFY_HEAD,
    render: NOTIFY_PATH,
    data: { page: 'notify' },
  },
  {
    path: SAVED_CHOICES_PATH,
    file: 'saved-choices.html',
    head: SAVED_CHOICES_HEAD,
  },
  // Served with a 404 status for every address that has no page.
  { path: '/404', file: '404.html', head: NOT_FOUND_HEAD },
]

/**
 * A candidate's profile page and their report form. `live` is false when
 * the profile file isn't the version that's published: the page then gets
 * the head only, and the app loads the published profile as usual.
 */
export function candidatePages(
  profile: CandidateProfile,
  live: boolean,
): PrerenderPage[] {
  const path = profilePath(profile.key)
  return [
    {
      path,
      file: `${path.slice(1)}.html`,
      head: profileHead(profile),
      ...(live && {
        render: path,
        data: { page: 'profile', profile },
      }),
    },
    {
      path: reportPath(profile.key),
      file: `${reportPath(profile.key).slice(1)}.html`,
      head: reportHead(profile.name),
    },
  ]
}

/** /races, each area's list of races and a page for every race. */
export function racePages(data: RaceData): PrerenderPage[] {
  const page = (path: string, head: PageHead): PrerenderPage => ({
    path,
    // Cloudflare serves /races/il/… from races/il/….html.
    file: `${path.slice(1)}.html`,
    head,
    render: path,
    data: { page: 'races' },
  })
  return [
    page(RACES_PATH, RACES_HEAD),
    ...data.lists.flatMap((list) => {
      const withProfiles = publishedFor(data, list).size > 0
      return [
        page(
          `${RACES_PATH}/${list.areaPath}`,
          raceAreaHead(list, withProfiles),
        ),
        ...list.races.map((race) =>
          page(racePath(race), raceHead(race, withProfiles)),
        ),
      ]
    }),
  ]
}

/** The race lists the pages are built from. */
export async function raceData(): Promise<RaceData> {
  return loadRaces()
}

/** The HTML inside #root for a page. */
export async function renderPage(page: PrerenderPage): Promise<string> {
  if (!page.render) return ''
  const handler = createStaticHandler(routes)
  const context = await handler.query(new Request(SITE_URL + page.render))
  if (context instanceof Response) {
    throw new Error(`${page.render} redirects (${context.status})`)
  }
  const queryClient = new QueryClient()
  // Race pages and profiles show races from the list.
  queryClient.setQueryData(RACES_QUERY_KEY, await loadRaces())
  if (page.data?.profile) {
    queryClient.setQueryData(
      ['profile', page.data.profile.key],
      page.data.profile,
    )
  }
  const router = createStaticRouter(handler.dataRoutes, context)
  const { prelude } = await prerenderToNodeStream(
    <QueryClientProvider client={queryClient}>
      <StaticRouterProvider router={router} context={context} hydrate={false} />
    </QueryClientProvider>,
  )
  let html = ''
  for await (const chunk of prelude) html += chunk
  return html
}
