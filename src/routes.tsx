import { Navigate, type RouteObject } from 'react-router'
import {
  GET_STARTED_PATH,
  NOTIFY_PATH,
  SAVED_CHOICES_PATH,
  type RouteHandle,
} from './ballot/profileLinks.ts'
import { BallotSessionProvider } from './components/BallotSession.tsx'
import { Layout } from './components/Layout.tsx'
import { GetStartedPage } from './pages/GetStartedPage.tsx'
import { HomePage } from './pages/HomePage.tsx'
import { LazyAboutPage } from './pages/LazyAboutPage.tsx'
import { HowProfilesPage } from './pages/HowProfilesPage.tsx'
import { LazyNotifyPage } from './pages/LazyNotifyPage.tsx'
import { LazyProfilePage } from './pages/LazyProfilePage.tsx'
import { LazyRacesPage } from './pages/LazyRacesPage.tsx'
import { LazyReportPage } from './pages/LazyReportPage.tsx'
import { NotFoundPage } from './pages/NotFoundPage.tsx'
import { PressPage } from './pages/PressPage.tsx'
import { SavedChoicesPage } from './pages/SavedChoicesPage.tsx'
import { SupportPage } from './pages/SupportPage.tsx'

// A candidate's pages: beside a profile, the whole ballot list from 840px
// (its race(s) at its top below that); beside its report form, just the race(s).
const candidate: RouteHandle = { detail: true, racePanel: true }

export const routes: RouteObject[] = [
  {
    element: <Layout />,
    children: [
      {
        // This session's lookup and sample, in memory above the address form
        // and the ballot so going between them keeps both.
        element: <BallotSessionProvider />,
        children: [
          {
            // New visitors land here (/ redirects when there's no ballot),
            // and "Search a new address" comes here.
            path: GET_STARTED_PATH,
            element: <GetStartedPage />,
          },
          {
            // "Tell me when VoteStack reaches my area", for visitors
            // outside the area it covers. No ballot beside it.
            path: NOTIFY_PATH,
            element: <LazyNotifyPage />,
          },
          {
            // Profiles are children of the home page, so the ballot it holds in
            // memory (never in the URL) survives opening a profile and coming back.
            path: '/',
            element: <HomePage />,
            children: [
              {
                path: 'candidates/:key',
                handle: { ...candidate, profile: true } satisfies RouteHandle,
                element: <LazyProfilePage />,
              },
              {
                path: 'candidates/:key/report',
                handle: candidate,
                element: <LazyReportPage />,
              },
              {
                // The voter's picks, read from this device only. A page of
                // its own, with no ballot list beside it.
                path: 'saved-choices',
                element: <SavedChoicesPage />,
              },
              {
                // Its old address, so earlier links still work.
                path: 'my-ballot',
                element: <Navigate to={SAVED_CHOICES_PATH} replace />,
              },
              {
                // Every race, browsable without an address: /races, an
                // area's list and one page per race (src/shared/races.ts).
                path: 'races/*',
                element: <LazyRacesPage />,
              },
              {
                path: 'how-profiles-are-made',
                element: <HowProfilesPage />,
              },
              {
                path: 'about',
                element: <LazyAboutPage />,
              },
              {
                path: 'support',
                element: <SupportPage />,
              },
              {
                path: 'press',
                element: <PressPage />,
              },
            ],
          },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]
