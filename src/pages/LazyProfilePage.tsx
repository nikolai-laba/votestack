import { lazyPage } from './lazyPage.tsx'

export const LazyProfilePage = lazyPage(() => import('./ProfilePage.tsx'))
