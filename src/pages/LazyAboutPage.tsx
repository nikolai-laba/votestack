import { lazyPage } from './lazyPage.tsx'

export const LazyAboutPage = lazyPage(() => import('./AboutPage.tsx'))
