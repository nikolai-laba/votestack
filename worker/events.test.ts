// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { eventResponse } from './events.ts'

const BROWSER =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1'

const VIEW = { e: 'view', page: 'report', from: 'landing' }

function send(events: unknown[], opts: { agent?: string; success?: boolean }) {
  const writeDataPoint = vi.fn()
  const request = new Request('https://votestack.org/api/event', {
    method: 'POST',
    headers: { 'User-Agent': opts.agent ?? BROWSER },
    body: JSON.stringify({ events }),
  })
  const response = eventResponse(request, {
    dataset: { writeDataPoint } as unknown as AnalyticsEngineDataset,
    limiter: { limit: async () => ({ success: opts.success ?? true }) },
  })
  const blobs = () =>
    writeDataPoint.mock.calls.map(
      (call) => call[0] as { blobs: string[]; doubles: number[] },
    )
  return { response, blobs }
}

describe('eventResponse drop counts', () => {
  it('counts a batch dropped as a bot', async () => {
    const { response, blobs } = send([VIEW], { agent: 'Googlebot/2.1' })
    expect((await response).status).toBe(204)
    expect(blobs()).toHaveLength(1)
    expect(blobs()[0].blobs).toEqual(['dropped', 'bot', '', ''])
  })

  it('counts a rate-limited batch', async () => {
    const { response, blobs } = send([VIEW], { success: false })
    expect((await response).status).toBe(429)
    expect(blobs()).toHaveLength(1)
    expect(blobs()[0].blobs).toEqual(['dropped', 'limited', '', ''])
  })

  it('counts rejected events in a batch', async () => {
    const { response, blobs } = send(
      [VIEW, { e: 'nope' }, { e: 'visit', step: 'x' }],
      {},
    )
    expect((await response).status).toBe(204)
    const points = blobs()
    expect(points).toHaveLength(2)
    expect(points[0].blobs[0]).toBe('view')
    expect(points[1].blobs).toEqual(['dropped', 'invalid', '', ''])
    expect(points[1].doubles).toEqual([2])
  })

  it('writes no drop row for a clean batch', async () => {
    const { response, blobs } = send([VIEW], {})
    await response
    expect(blobs().filter((p) => p.blobs[0] === 'dropped')).toEqual([])
  })
})
