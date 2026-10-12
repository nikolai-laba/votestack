import { lazy, Suspense } from 'react'
import { ProfileSkeleton } from '../components/profile/ProfileSkeleton.tsx'

// The About page loads on demand, keeping it out of the address screen's
// bundle so it loads fast on slow phones.
const AboutPage = lazy(() => import('./AboutPage.tsx'))

export function LazyAboutPage() {
  return (
    <Suspense fallback={<ProfileSkeleton />}>
      <AboutPage />
    </Suspense>
  )
}
