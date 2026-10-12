import { lazy, Suspense } from 'react'
import { ProfileSkeleton } from '../components/profile/ProfileSkeleton.tsx'

// Profiles load on demand, keeping them out of the address screen's bundle
// so it loads fast on slow phones.
const ProfilePage = lazy(() => import('./ProfilePage.tsx'))

export function LazyProfilePage() {
  return (
    <Suspense fallback={<ProfileSkeleton />}>
      <ProfilePage />
    </Suspense>
  )
}
