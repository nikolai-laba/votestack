import { lazyPage } from './lazyPage.tsx'

export const LazyRacesPage = lazyPage(() => import('./RacesPage.tsx'))
