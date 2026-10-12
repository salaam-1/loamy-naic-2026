import { describe, expect, it } from 'vitest'
import {
  ALLOWED_IMAGE_TYPES, MAX_EVIDENCE_BYTES, MAX_UPLOAD_ATTEMPTS,
  captureFeedback, checkFile, evidenceTypeFor, hashBlob, idempotencyKey,
  retryDelayMs, shouldRetry, storagePathFor, syncLabel,
} from '../../src/lib/evidence'

describe('content hashing is what makes duplicate detection work', () => {
  it('produces a stable hex digest', async () => {
    const h = await hashBlob(new Blob(['field photo bytes']))
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })

  it('gives IDENTICAL bytes the same hash regardless of filename', async () => {
    // The whole point: the same photograph filed against two farms collides
    // server-side even after a rename.
    const a = await hashBlob(new Blob(['same bytes']))
    const b = await hashBlob(new Blob(['same bytes']))
    expect(a).toBe(b)
  })

  it('gives different bytes different hashes', async () => {
    const a = await hashBlob(new Blob(['farm a']))
    const b = await hashBlob(new Blob(['farm b']))
    expect(a).not.toBe(b)
  })
})

describe('idempotency survives a failed upload', () => {
  it('keys on case AND hash, so a retry collides', () => {
    const k1 = idempotencyKey('case-1', 'abc123', 'fallback')
    const k2 = idempotencyKey('case-1', 'abc123', 'different-fallback')
    expect(k1).toBe(k2)
  })

  it('does not collide across cases', () => {
    expect(idempotencyKey('case-1', 'abc', 'f'))
      .not.toBe(idempotencyKey('case-2', 'abc', 'f'))
  })

  it('does not collide for two different photos on one case', () => {
    expect(idempotencyKey('case-1', 'aaa', 'f'))
      .not.toBe(idempotencyKey('case-1', 'bbb', 'f'))
  })

  it('falls back when there is no hash yet', () => {
    expect(idempotencyKey('case-1', null, 'local-7')).toBe('case-1:local-7')
  })
})

describe('the client-side file gate', () => {
  it('accepts an ordinary field photograph', () => {
    expect(checkFile({ type: 'image/jpeg', size: 2_000_000 })).toEqual({ ok: true })
  })

  it('refuses an oversized file with a usable message', () => {
    const r = checkFile({ type: 'image/jpeg', size: MAX_EVIDENCE_BYTES + 1 })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('too_large')
      expect(r.message).toMatch(/smaller photo/i)
    }
  })

  it('refuses a disguised executable', () => {
    const r = checkFile({ type: 'application/x-msdownload', size: 1000 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('wrong_type')
  })

  it('refuses an empty file', () => {
    const r = checkFile({ type: 'image/jpeg', size: 0 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('empty')
  })

  it('accepts every declared image type', () => {
    for (const t of ALLOWED_IMAGE_TYPES) {
      expect(checkFile({ type: t, size: 1000 }).ok, t).toBe(true)
    }
  })

  it('classifies video separately from photographs', () => {
    expect(evidenceTypeFor('video/mp4')).toBe('video')
    expect(evidenceTypeFor('image/jpeg')).toBe('photo')
  })
})

describe('storage paths are foldered by case', () => {
  it('puts a capture under its own case folder', () => {
    // The bucket policy keys on the first path segment.
    const p = storagePathFor('case-abc', 'f'.repeat(64), 'image/jpeg')
    expect(p.startsWith('case-abc/')).toBe(true)
    expect(p.endsWith('.jpg')).toBe(true)
  })

  it('derives the extension from the MIME type, not a client filename', () => {
    expect(storagePathFor('c', 'a'.repeat(64), 'image/png')).toMatch(/\.png$/)
    expect(storagePathFor('c', 'a'.repeat(64), 'video/quicktime')).toMatch(/\.mov$/)
  })
})

describe('sync state is communicated honestly', () => {
  it('distinguishes saved-on-device from sent', () => {
    const s = syncLabel(3, 0, false)
    expect(s.state).toBe('offline')
    expect(s.label).toMatch(/saved offline/i)
    // An agent must not read "saved" as "Loamy has it".
    expect(s.detail).toMatch(/will upload when you have signal/i)
    expect(s.detail.toLowerCase()).not.toContain('sent')
  })

  it('says plainly when everything has arrived', () => {
    const s = syncLabel(0, 0, true)
    expect(s.state).toBe('synced')
    expect(s.detail).toMatch(/reached loamy/i)
  })

  it('surfaces failures ahead of everything else', () => {
    const s = syncLabel(2, 1, true)
    expect(s.state).toBe('failed')
    expect(s.label).toMatch(/not sent/)
  })

  it('reports failures even while offline', () => {
    expect(syncLabel(2, 1, false).state).toBe('failed')
  })

  it('invites capture while offline rather than blocking it', () => {
    expect(syncLabel(0, 0, false).detail).toMatch(/you can still capture/i)
  })
})

describe('retry backs off and then stops', () => {
  it('grows the delay', () => {
    expect(retryDelayMs(1)).toBeLessThan(retryDelayMs(3))
  })

  it('caps so a field device does not spin', () => {
    expect(retryDelayMs(50)).toBeLessThanOrEqual(30_000)
  })

  it('stops retrying after the limit and hands it to the agent', () => {
    expect(shouldRetry({ attempts: 1, state: 'failed' })).toBe(true)
    expect(shouldRetry({ attempts: MAX_UPLOAD_ATTEMPTS, state: 'failed' })).toBe(false)
  })

  it('never retries something already uploaded', () => {
    expect(shouldRetry({ attempts: 0, state: 'uploaded' })).toBe(false)
  })
})

describe('capture feedback never accuses the agent', () => {
  it('confirms a clean capture', () => {
    expect(captureFeedback([]).tone).toBe('ok')
  })

  it('says a flagged capture goes to review, not that it is fraud', () => {
    const f = captureFeedback(['gps_far_from_subject', 'duplicate_evidence'])
    expect(f.tone).toBe('review')
    expect(f.message).toMatch(/reviewer will look/i)
    expect(f.message.toLowerCase()).not.toContain('fraud')
    expect(f.message.toLowerCase()).not.toContain('rejected')
  })

  it('still confirms the capture was kept', () => {
    expect(captureFeedback(['low_gps_accuracy']).message).toMatch(/^Captured/)
  })
})
