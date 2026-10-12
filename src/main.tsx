import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createBrowserRouter } from 'react-router'
import { routes } from './routes.tsx'
// Self-hosted fonts: no third-party font requests.
import '@fontsource-variable/atkinson-hyperlegible-next'
import '@fontsource-variable/literata/opsz.css'
import './index.css'

const queryClient = new QueryClient()
const router = createBrowserRouter(routes)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
