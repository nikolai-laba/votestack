import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createBrowserRouter } from 'react-router'
import { HOME_HEAD, applyHead } from './head.ts'
import { LazyAboutPage } from './pages/LazyAboutPage.tsx'
import { LazyNotifyPage } from './pages/LazyNotifyPage.tsx'
import { LazyProfilePage } from './pages/LazyProfilePage.tsx'
import { LazyRacesPage } from './pages/LazyRacesPage.tsx'
import { readPrerenderData, type PrerenderData } from './prerenderData.ts'
import { RACES_QUERY_KEY, loadRaces } from './races/data.ts'
import { routes } from './routes.tsx'
// Self-hosted fonts: no third-party font requests.
import '@fontsource-variable/atkinson-hyperlegible-next'
import '@fontsource-variable/literata/wght.css'
import './index.css'

const queryClient = new QueryClient()
const router = createBrowserRouter(routes)

// A prerendered page (src/prerender.tsx) shows its content before the app
// starts. Load its on-demand page first and reuse the profile it was built
// with, so the app's first render matches it instead of flashing a skeleton.
const preloadRaces = () =>
  loadRaces().then((data) => queryClient.setQueryData(RACES_QUERY_KEY, data))
const PRELOAD: Record<PrerenderData['page'], () => Promise<unknown>> = {
  profile: () => Promise.all([LazyProfilePage.preload(), preloadRaces()]),
  about: LazyAboutPage.preload,
  notify: LazyNotifyPage.preload,
  races: () => Promise.all([LazyRacesPage.preload(), preloadRaces()]),
}
const prerendered = readPrerenderData()
if (prerendered?.profile) {
  queryClient.setQueryData(
    ['profile', prerendered.profile.key],
    prerendered.profile,
  )
}
function render() {
  applyHead(HOME_HEAD)
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  )
}

// A failed preload still starts the app; the page then loads as usual.
if (prerendered) PRELOAD[prerendered.page]().then(render, render)
else render()
