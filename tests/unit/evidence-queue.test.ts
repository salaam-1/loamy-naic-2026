import { describe, expect, it } from 'vitest'
import { MAX_UPLOAD_ATTEMPTS, retryDelayMs, type PendingEvidence } from '../../src/lib/evidence'
import {
  EvidenceQueue, memoryStore, type UploadResult,
} from '../../src/lib/evidenceQueue'

const ok = (): UploadResult => ({ evidenceId: 'ev-1', flags: [], distanceM: null, clockSkewSeconds: 0 })

/** Records what was sent, in the order it was sent. */
function recorder(fail?: (item: PendingEvidence) => boolean) {
  const sent: PendingEvidence[] = []
  const uploader = async (item: PendingEvidence) => {
    if (fail?.(item)) throw new Error('network unreachable')
    sent.push(item)
    return ok()
  }
  return { sent, uploader }
}

function queue(uploader: (item: PendingEvidence) => Promise<UploadResult>) {
  return new EvidenceQueue(memoryStore(), uploader)
}

describe('a capture is never lost to a bad connection', () => {
  it('accepts a capture with no network at all', async () => {
    const q = queue(async () => { throw new Error('offline') })
    await q.enqueue({ caseId: 'c1', evidenceType: 'gps_point', lat: 11.1, lng: 7.7 })
    // The agent's work is on the device even though nothing was sent.
    expect((await q.list())).toHaveLength(1)
  })

  it('keeps a failed capture queued rather than dropping it', async () => {
    const q = queue(async () => { throw new Error('offline') })
    await q.enqueue({ caseId: 'c1', evidenceType: 'gps_point', lat: 1, lng: 1 })
    const r = await q.flush()
    expect(r.uploaded).toBe(0)
    expect(r.failed).toBe(1)
    const [item] = await q.list()
    expect(item.attempts).toBe(1)
    expect(item.lastError).toMatch(/offline/)
    expect(item.state).toBe('failed')
  })

  it('removes an item only once the server has it', async () => {
    const { sent, uploader } = recorder()
    const q = queue(uploader)
    await q.enqueue({ caseId: 'c1', evidenceType: 'gps_point', lat: 1, lng: 1 })
    await q.flush()
    expect(sent).toHaveLength(1)
    expect(await q.list()).toHaveLength(0)
  })
})

describe('the device clock is carried, not corrected', () => {
  it('sends the original captured_at hours after the fact', async () => {
    const { sent, uploader } = recorder()
    const q = queue(uploader)
    const morning = '2026-09-20T06:30:00.000Z'
    await q.enqueue({ caseId: 'c1', evidenceType: 'gps_point', capturedAt: morning, lat: 1, lng: 1 })
    await q.flush()
    // Restamping on upload would erase the only record of when the agent was
    // actually standing on the farm.
    expect(sent[0].capturedAt).toBe(morning)
  })
})

describe('capture order survives the queue', () => {
  it('flushes oldest capture first regardless of enqueue order', async () => {
    const { sent, uploader } = recorder()
    const q = queue(uploader)
    await q.enqueue({ caseId: 'c1', evidenceType: 'gps_point', capturedAt: '2026-09-20T14:00:00.000Z', lat: 2, lng: 2 })
    await q.enqueue({ caseId: 'c1', evidenceType: 'gps_point', capturedAt: '2026-09-20T08:00:00.000Z', lat: 1, lng: 1 })
    await q.flush()
    // Out-of-order uploads would make the server's impossible-travel check
    // see an agent leaping backwards, flagging honest work.
    expect(sent.map((s) => s.capturedAt)).toEqual([
      '2026-09-20T08:00:00.000Z',
      '2026-09-20T14:00:00.000Z',
    ])
  })

  it('stops at the first failure instead of skipping ahead', async () => {
    let calls = 0
    const sent: string[] = []
    const q = queue(async (item) => {
      calls += 1
      if (calls === 1) throw new Error('signal lost')
      sent.push(item.capturedAt)
      return ok()
    })
    await q.enqueue({ caseId: 'c1', evidenceType: 'gps_point', capturedAt: '2026-09-20T08:00:00.000Z' })
    await q.enqueue({ caseId: 'c1', evidenceType: 'gps_point', capturedAt: '2026-09-20T09:00:00.000Z' })
    const r = await q.flush()
    expect(r.stoppedEarly).toBe(true)
    expect(sent).toEqual([])
    // Both are still on the device, in order, waiting.
    expect((await q.list()).map((i) => i.capturedAt)).toEqual([
      '2026-09-20T08:00:00.000Z',
      '2026-09-20T09:00:00.000Z',
    ])
  })
})

describe('retry backs off and eventually hands over to the agent', () => {
  it('does not attempt again until the backoff has elapsed', async () => {
    let calls = 0
    const q = queue(async () => { calls += 1; throw new Error('offline') })
    await q.enqueue({ caseId: 'c1', evidenceType: 'gps_point' })
    const t0 = Date.now()
    await q.flush(t0)
    expect(calls).toBe(1)
    await q.flush(t0 + 10)      // immediately again: still backing off
    expect(calls).toBe(1)
    await q.flush(t0 + retryDelayMs(1) + 1)
    expect(calls).toBe(2)
  })

  it('gives up after the attempt limit and reports it as failed', async () => {
    let t = Date.now()
    const q = queue(async () => { throw new Error('offline') })
    await q.enqueue({ caseId: 'c1', evidenceType: 'gps_point' })
    for (let i = 0; i < MAX_UPLOAD_ATTEMPTS; i += 1) {
      await q.flush(t)
      t += 60_000
    }
    const counts = await q.counts()
    expect(counts.failed).toBe(1)
    expect(counts.pending).toBe(0)
    // Still on the device: giving up is not the same as discarding.
    expect(await q.list()).toHaveLength(1)
  })

  it('steps over an exhausted capture so one bad item cannot wedge the queue', async () => {
    let t = Date.now()
    const sent: string[] = []
    const q = queue(async (item) => {
      if (item.caseId === 'poisoned') throw new Error('rejected')
      sent.push(item.caseId)
      return ok()
    })
    await q.enqueue({ caseId: 'poisoned', evidenceType: 'gps_point', capturedAt: '2026-09-20T08:00:00.000Z' })
    await q.enqueue({ caseId: 'good', evidenceType: 'gps_point', capturedAt: '2026-09-20T09:00:00.000Z' })
    for (let i = 0; i < MAX_UPLOAD_ATTEMPTS; i += 1) {
      await q.flush(t)
      t += 60_000
    }
    await q.flush(t)
    expect(sent).toEqual(['good'])
    expect((await q.counts()).failed).toBe(1)
  })

  it('an agent-initiated retry restores the attempts', async () => {
    let t = Date.now()
    let allow = false
    const q = queue(async () => {
      if (!allow) throw new Error('offline')
      return ok()
    })
    const item = await q.enqueue({ caseId: 'c1', evidenceType: 'gps_point' })
    for (let i = 0; i < MAX_UPLOAD_ATTEMPTS; i += 1) {
      await q.flush(t)
      t += 60_000
    }
    expect((await q.counts()).failed).toBe(1)
    allow = true
    await q.retry(item.id)
    await q.flush(t)
    expect(await q.list()).toHaveLength(0)
  })
})

describe('idempotency stops a retry becoming a second piece of evidence', () => {
  it('re-adding the same photograph to the same case does not duplicate it', async () => {
    const { uploader } = recorder()
    const q = queue(uploader)
    const bytes = () => new Blob(['identical field photo'], { type: 'image/jpeg' })
    await q.enqueue({ caseId: 'c1', evidenceType: 'photo', blob: bytes() })
    await q.enqueue({ caseId: 'c1', evidenceType: 'photo', blob: bytes() })
    expect(await q.list()).toHaveLength(1)
  })

  it('the same photograph on a different case is a separate capture', async () => {
    const q = queue(async () => ok())
    const bytes = () => new Blob(['identical field photo'], { type: 'image/jpeg' })
    await q.enqueue({ caseId: 'c1', evidenceType: 'photo', blob: bytes() })
    await q.enqueue({ caseId: 'c2', evidenceType: 'photo', blob: bytes() })
    // Two captures locally -- the SERVER decides this is a duplicate and
    // flags it. That judgement is not the client's to make.
    expect(await q.list()).toHaveLength(2)
  })

  it('derives a content-addressed storage path so a retry overwrites', async () => {
    const q = queue(async () => ok())
    const item = await q.enqueue({
      caseId: 'c1', evidenceType: 'photo', blob: new Blob(['x'], { type: 'image/png' }),
    })
    expect(item.storagePath).toMatch(/^c1\/[0-9a-f]{32}\.png$/)
    expect(item.contentHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('a capture with no bytes still gets a unique id', async () => {
    const q = queue(async () => ok())
    const a = await q.enqueue({ caseId: 'c1', evidenceType: 'gps_point', lat: 1, lng: 1 })
    const b = await q.enqueue({ caseId: 'c1', evidenceType: 'gps_point', lat: 1, lng: 1 })
    expect(a.id).not.toBe(b.id)
    expect(await q.list()).toHaveLength(2)
  })
})

describe('the agent can discard what has not been sent', () => {
  it('drops a queued capture', async () => {
    const q = queue(async () => ok())
    const item = await q.enqueue({ caseId: 'c1', evidenceType: 'photo', blob: new Blob(['a']) })
    await q.discard(item.id)
    expect(await q.list()).toHaveLength(0)
  })
})
