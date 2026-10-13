import { lazy, Suspense, useState, type ComponentType } from 'react'
import { ProfileSkeleton } from '../components/profile/ProfileSkeleton.tsx'

/**
 * A page loaded on demand, behind a skeleton, keeping it out of the address
 * screen's bundle so that screen loads fast on slow phones. `preload()`
 * fetches it ahead of time; a page that has already loaded renders straight
 * away, so a prerendered page isn't swapped for a skeleton while the app
 * starts (main.tsx).
 */
export function lazyPage(load: () => Promise<{ default: ComponentType }>) {
  let loaded: ComponentType | null = null
  const preload = () =>
    load().then((module) => {
      loaded = module.default
      return module
    })
  const Lazy = lazy(preload)
  function Page() {
    // Chosen once, so the page isn't remounted (losing what was typed) when
    // the module arrives while it's open.
    const [Component] = useState(() => loaded ?? Lazy)
    return (
      <Suspense fallback={<ProfileSkeleton />}>
        <Component />
      </Suspense>
    )
  }
  return Object.assign(Page, { preload })
}
