import { useEffect, useImperativeHandle, useRef, type Ref } from 'react'
import { themeStore } from '../../theme/themePreference.ts'

// Cloudflare Turnstile, the check that a person (not a bot) sends a form (an
// error report or a sign-up). The script loads from challenges.cloudflare.com
// only when such a form is on screen; Cloudflare requires loading it from
// there.

const SCRIPT_URL =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

interface TurnstileOptions {
  sitekey: string
  action?: string
  theme?: 'auto' | 'light' | 'dark'
  size?: 'normal' | 'flexible' | 'compact'
  callback?: (token: string) => void
  'expired-callback'?: () => void
  'error-callback'?: () => void
}

interface TurnstileApi {
  render: (container: HTMLElement, options: TurnstileOptions) => string
  reset: (widgetId: string) => void
  remove: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

let loading: Promise<TurnstileApi> | null = null

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT_URL
    script.async = true
    script.addEventListener('load', () =>
      window.turnstile
        ? resolve(window.turnstile)
        : reject(new Error('Turnstile did not load')),
    )
    script.addEventListener('error', () => {
      loading = null
      script.remove()
      reject(new Error('Turnstile did not load'))
    })
    document.head.append(script)
  })
  return loading
}

export interface TurnstileHandle {
  /** Get a fresh token: each one works only once. */
  reset: () => void
}

export function Turnstile({
  siteKey,
  action = 'report',
  onToken,
  onError,
  ref,
}: {
  siteKey: string
  /** Which form this check is for, as shown in Cloudflare's analytics. */
  action?: 'report' | 'notify'
  /** A token, or null when it expired or was reset. */
  onToken: (token: string | null) => void
  onError: () => void
  ref?: Ref<TurnstileHandle>
}) {
  const container = useRef<HTMLDivElement>(null)
  const widget = useRef<{ api: TurnstileApi; id: string } | null>(null)
  // Callbacks change on every render; the widget is rendered once.
  const handlers = useRef({ onToken, onError })
  useEffect(() => {
    handlers.current = { onToken, onError }
  })

  useImperativeHandle(ref, () => ({
    reset() {
      handlers.current.onToken(null)
      if (widget.current) widget.current.api.reset(widget.current.id)
    },
  }))

  useEffect(() => {
    let cancelled = false
    loadTurnstile().then(
      (api) => {
        if (cancelled || !container.current) return
        const id = api.render(container.current, {
          sitekey: siteKey,
          action,
          // The site's mode, which may differ from the device's (set when
          // the widget renders).
          theme: themeStore.getSnapshot(),
          size: 'flexible',
          callback: (token) => handlers.current.onToken(token),
          'expired-callback': () => handlers.current.onToken(null),
          'error-callback': () => handlers.current.onError(),
        })
        widget.current = { api, id }
      },
      () => {
        if (!cancelled) handlers.current.onError()
      },
    )
    return () => {
      cancelled = true
      if (widget.current) widget.current.api.remove(widget.current.id)
      widget.current = null
    }
  }, [siteKey, action])

  // Reserve the widget's height (65px) so the button doesn't jump.
  return <div ref={container} className="min-h-[65px]" />
}
