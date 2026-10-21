import { useRef, useState, type KeyboardEvent } from 'react'
import { Link, NavLink, Outlet, useMatches } from 'react-router'
import {
  ABOUT_PATH,
  PRESS_PATH,
  SAVED_CHOICES_PATH,
  SUPPORT_PATH,
  type RouteHandle,
} from '../ballot/profileLinks.ts'
import { useBallotStore } from '../picks/store.ts'
import { pickCounts } from '../picks/summary.ts'
import { useUsageViews } from '../metrics/listen.ts'
import { useTheme } from '../theme/themePreference.ts'
import { APP_VERSION } from '../version.ts'
import { ChevronDownIcon, MoonIcon, SunIcon } from './icons.tsx'

/**
 * The VoteStack logo (mark and wordmark), in the version for the site's
 * current mode, so the menu's light/dark switch changes it too. The link
 * around it names it, so the image itself is decorative.
 */
function Wordmark() {
  const [theme] = useTheme()
  return (
    <img
      src={
        theme === 'dark'
          ? '/brand/votestack-wordmark-dark.png'
          : '/brand/votestack-wordmark.png'
      }
      alt=""
      width={506}
      height={84}
      className="h-7 w-auto"
    />
  )
}

export function Layout() {
  // List-detail pages (a profile beside the ballot) get up to 1200px on wide
  // screens; everything else stays at reading width.
  const detail = useMatches().some((m) => (m.handle as RouteHandle)?.detail)
  const width = detail ? 'max-w-3xl lg:max-w-[75rem]' : 'max-w-3xl'
  useUsageViews()
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-text">
      {/* First stop for keyboard users: past the header to the page itself. */}
      <a
        href="#main"
        className="sr-only rounded-md bg-surface px-4 text-label font-semibold focus:not-sr-only focus:absolute focus:start-4 focus:top-2 focus:z-10 focus:inline-flex focus:min-h-11 focus:items-center"
      >
        Skip to main content
      </a>
      <header className="border-b border-line bg-surface">
        <div
          className={`mx-auto flex ${width} flex-wrap items-center justify-between gap-x-6 px-4 py-3`}
        >
          <Link
            to="/"
            aria-label="VoteStack home"
            className="inline-flex min-h-11 items-center no-underline"
          >
            <Wordmark />
          </Link>
          <SiteMenu />
        </div>
      </header>

      {/* tabIndex -1 lets the skip link move focus here in every browser. */}
      <main
        id="main"
        tabIndex={-1}
        className={`mx-auto w-full ${width} flex-1 px-4 py-8 focus:outline-none`}
      >
        <Outlet />
      </main>

      <footer className="border-t border-line bg-surface text-small text-muted">
        <div className={`mx-auto ${width} space-y-3 px-4 py-6`}>
          <p className="max-w-[65ch] font-semibold text-text">
            Independent, nonpartisan, open source. Not a government site. We
            don&apos;t tell you how to vote.
          </p>
          <p className="max-w-[65ch]">
            Always confirm your ballot with the{' '}
            <a
              href="https://chicagoelections.gov"
              target="_blank"
              rel="noreferrer"
            >
              Chicago Board of Election Commissioners
            </a>{' '}
            or the{' '}
            <a
              href="https://www.cookcountyclerkil.gov/elections"
              target="_blank"
              rel="noreferrer"
            >
              Cook County Clerk
            </a>{' '}
            in Illinois, or the{' '}
            <a href="https://www.lavote.gov" target="_blank" rel="noreferrer">
              Los Angeles County Registrar-Recorder/County Clerk
            </a>{' '}
            in California.
          </p>
          {/* Required by the City of Chicago's data terms (see data/README.md). */}
          <p className="max-w-[65ch] text-caption">
            This site provides applications using data that has been modified
            for use from its original source, www.cityofchicago.org, the
            official website of the City of Chicago. The City of Chicago makes
            no claims as to the content, accuracy, timeliness, or completeness
            of any of the data provided at this site. The data provided at this
            site is subject to change at any time. It is understood that the
            data provided at this site is being used at one&apos;s own risk.
          </p>
          {/* One line, each link a 44px target with room between them. */}
          <ul className="flex flex-wrap gap-x-6">
            <li>
              <Link
                to={ABOUT_PATH}
                className="inline-flex min-h-11 items-center"
              >
                About VoteStack
              </Link>
            </li>
            <li>
              <Link
                to={SUPPORT_PATH}
                className="inline-flex min-h-11 items-center"
              >
                Support VoteStack
              </Link>
            </li>
            <li>
              <Link
                to={PRESS_PATH}
                className="inline-flex min-h-11 items-center"
              >
                Press
              </Link>
            </li>
            <li>
              <a
                href="https://github.com/nikolai-laba/votestack"
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center"
              >
                GitHub
              </a>
            </li>
            <li>
              <a
                href="mailto:nikolai@votestack.org"
                className="inline-flex min-h-11 items-center"
              >
                Contact
              </a>
            </li>
          </ul>
          <p className="text-caption">
            &copy; 2026 VoteStack, LLC. Open source under the Apache-2.0
            license. Version {APP_VERSION}.
          </p>
        </div>
      </footer>
    </div>
  )
}

const MENU_ID = 'site-menu'

/**
 * The site menu: inline links from 600px, behind a Menu button below that.
 * The current page is marked with aria-current and the highlight fill (an
 * underline in forced-colours mode); links have no underline (user's
 * choice, 2026-10-11).
 */
function SiteMenu() {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const { ballot, picks } = useBallotStore()
  const picked = ballot ? pickCounts(ballot, picks).picked : 0

  function close() {
    setOpen(false)
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || !open) return
    setOpen(false)
    button.current?.focus()
  }

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex min-h-11 items-center rounded-sm px-3 font-semibold no-underline ${
      isActive
        ? // Forced colours drop the fill, so the current page gets an
          // underline there instead.
          'bg-highlight text-on-highlight forced-colors:underline forced-colors:decoration-[3px] forced-colors:underline-offset-[5px]'
        : 'text-text'
    }`

  return (
    <div onKeyDown={onKeyDown} className="contents">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={MENU_ID}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex min-h-11 items-center gap-1 rounded-md border-2 border-field px-3 font-semibold text-text md:hidden"
      >
        Menu
        <ChevronDownIcon
          className={`size-5 shrink-0 motion-safe:transition-transform motion-safe:duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      <nav
        id={MENU_ID}
        aria-label="Site"
        className={`w-full md:w-auto ${open ? '' : 'max-md:hidden'}`}
      >
        <ul className="flex flex-col gap-2 pt-3 md:flex-row md:pt-0">
          <li>
            {/* The ballot list is the home page. */}
            <NavLink to="/" end onClick={close} className={linkClass}>
              My ballot
            </NavLink>
          </li>
          <li>
            <NavLink to={ABOUT_PATH} onClick={close} className={linkClass}>
              About
            </NavLink>
          </li>
          <li>
            <NavLink
              to={SAVED_CHOICES_PATH}
              onClick={close}
              className={linkClass}
            >
              {picked > 0
                ? `Saved choices (${picked} picked)`
                : 'Saved choices'}
            </NavLink>
          </li>
          <li>
            <ThemeButton />
          </li>
        </ul>
      </nav>
    </div>
  )
}

/**
 * Switches between light and dark mode, as an icon (moon or sun) whose
 * accessible name and tooltip say what it switches to,
 * so the name alone tells a screen reader what will happen (no aria-pressed,
 * whose state would contradict a changing label). The site follows the
 * device until this is pressed (src/theme/themePreference.ts).
 */
function ThemeButton() {
  const [theme, setTheme] = useTheme()
  const next = theme === 'dark' ? 'light' : 'dark'
  const Icon = next === 'dark' ? MoonIcon : SunIcon
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={next === 'dark' ? 'Dark mode' : 'Light mode'}
      title={next === 'dark' ? 'Dark mode' : 'Light mode'}
      className="flex min-h-11 min-w-11 items-center justify-center rounded-sm text-text"
    >
      <Icon />
    </button>
  )
}
