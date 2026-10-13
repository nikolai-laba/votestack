import { lazyPage } from './lazyPage.tsx'

// With the sign-up form's Turnstile check.
export const LazyNotifyPage = lazyPage(() => import('./NotifyPage.tsx'))
