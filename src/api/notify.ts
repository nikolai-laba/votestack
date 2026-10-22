// Client for the Worker's POST /api/notify. A sign-up carries only an email
// address, a ZIP code and where on the site the form was.

import type { Signup, SignupField } from '../shared/notify.ts'

export type SignupErrorKind =
  'invalid' | 'verification' | 'rate_limited' | 'unavailable'

export class SignupSendError extends Error {
  readonly kind: SignupErrorKind
  /** Field errors from the Worker, for 'invalid'. */
  readonly fields: Partial<Record<SignupField, string>>

  constructor(
    kind: SignupErrorKind,
    fields: Partial<Record<SignupField, string>> = {},
  ) {
    super(kind)
    this.kind = kind
    this.fields = fields
  }
}

export async function sendSignup(
  signup: Signup & { turnstileToken: string },
): Promise<void> {
  let res: Response
  try {
    res = await fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signup),
      cache: 'no-store',
    })
  } catch {
    throw new SignupSendError('unavailable')
  }
  if (res.ok) return
  if (res.status === 400) {
    const body = (await res.json().catch(() => null)) as {
      fields?: Partial<Record<SignupField, string>>
    } | null
    // A 400 without field errors is a missing or malformed token.
    if (!body?.fields) throw new SignupSendError('verification')
    throw new SignupSendError('invalid', body.fields)
  }
  if (res.status === 403) throw new SignupSendError('verification')
  if (res.status === 429) throw new SignupSendError('rate_limited')
  throw new SignupSendError('unavailable')
}
