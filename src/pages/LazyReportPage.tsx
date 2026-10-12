import { lazy, Suspense } from 'react'
import { ProfileSkeleton } from '../components/profile/ProfileSkeleton.tsx'

// The report form and its Turnstile check load on demand, keeping them out of
// the address screen's bundle so it loads fast on slow phones.
const ReportPage = lazy(() => import('./ReportPage.tsx'))

export function LazyReportPage() {
  return (
    <Suspense fallback={<ProfileSkeleton />}>
      <ReportPage />
    </Suspense>
  )
}
