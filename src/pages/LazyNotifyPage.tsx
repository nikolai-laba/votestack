import { lazy, Suspense } from 'react'
import { ProfileSkeleton } from '../components/profile/ProfileSkeleton.tsx'

// The sign-up form and its Turnstile check load on demand, keeping them out
// of the address screen's bundle so it loads fast on slow phones.
const NotifyPage = lazy(() => import('./NotifyPage.tsx'))

export function LazyNotifyPage() {
  return (
    <Suspense fallback={<ProfileSkeleton />}>
      <NotifyPage />
    </Suspense>
  )
}
