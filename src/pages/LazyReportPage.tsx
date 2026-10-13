import { lazyPage } from './lazyPage.tsx'

// With the report form's Turnstile check.
export const LazyReportPage = lazyPage(() => import('./ReportPage.tsx'))
