import { useSyncExternalStore } from 'react'

// Whether the app is running: false in a prerendered page (src/prerender.tsx
// renders with the server snapshot), true once the app renders in the
// browser. A form's submit button stays disabled until then, so a form sent
// before the app runs never goes to the server as a plain page request.

/** Whether the app runs never changes, so there's nothing to subscribe to. */
const noChanges = () => () => {}

export const useAppRunning = () =>
  useSyncExternalStore(
    noChanges,
    () => true,
    () => false,
  )
