// Client for the Worker's POST /api/report. Reports carry only what
// the reader wrote about the profile; no address or contact details.

import type { ProfileReport, ReportField } from '../shared/report.ts'

export type ReportErrorKind =
  'invalid' | 'verification' | 'rate_limited' | 'not_found' | 'unavailable'

export class ReportSendError extends Error {
  readonly kind: ReportErrorKind
  /** Field errors from the Worker, for 'invalid'. */
  readonly fields: Partial<Record<ReportField, string>>

  constructor(
    kind: ReportErrorKind,
    fields: Partial<Record<ReportField, string>> = {},
  ) {
    super(kind)
    this.kind = kind
    this.fields = fields
  }
}

export async function sendReport(
  report: ProfileReport & { turnstileToken: string },
): Promise<void> {
  let res: Response
  try {
    res = await fetch('/api/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
      cache: 'no-store',
    })
  } catch {
    throw new ReportSendError('unavailable')
  }
  if (res.ok) return
  if (res.status === 400) {
    const body = (await res.json().catch(() => null)) as {
      fields?: Partial<Record<ReportField, string>>
    } | null
    // A 400 without field errors is a missing or malformed token.
    if (!body?.fields) throw new ReportSendError('verification')
    throw new ReportSendError('invalid', body.fields)
  }
  if (res.status === 403) throw new ReportSendError('verification')
  if (res.status === 404) throw new ReportSendError('not_found')
  if (res.status === 429) throw new ReportSendError('rate_limited')
  throw new ReportSendError('unavailable')
}
