import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ShareProfile } from '../../src/components/profile/ShareProfile'

/**
 * Sharing has three paths and only one of them is the happy one, so all three
 * are exercised: the device share sheet, the clipboard, and the fallback for
 * when the clipboard is blocked (insecure contexts and several in-app
 * browsers, which is where a WhatsApp-shared link is most likely to be
 * opened).
 */

const originalShare = (navigator as { share?: unknown }).share

beforeEach(() => {
  delete (navigator as { share?: unknown }).share
  Object.defineProperty(window, 'location', {
    value: { origin: 'https://loamy.example' },
    writable: true,
  })
})

afterEach(() => {
  cleanup()
  if (originalShare) (navigator as { share?: unknown }).share = originalShare
  vi.restoreAllMocks()
})

function setClipboard(impl: () => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn(impl) },
    configurable: true,
  })
}

describe('with no device share sheet', () => {
  it('offers to copy rather than to share', () => {
    setClipboard(async () => {})
    render(<ShareProfile username="sahel_grains" displayName="Sahel Grains" />)
    expect(screen.getByRole('button', { name: /copy link/i })).toBeTruthy()
  })

  it('copies the canonical profile URL', async () => {
    setClipboard(async () => {})
    render(<ShareProfile username="sahel_grains" displayName="Sahel Grains" />)
    fireEvent.click(screen.getByRole('button', { name: /copy link/i }))
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://loamy.example/u/sahel_grains')
    })
  })

  it('builds the URL from the handle, not from the current path', async () => {
    // Sharing from /dashboard/... must still produce /u/:username.
    setClipboard(async () => {})
    render(<ShareProfile username="kano_agro" displayName="Kano Agro" />)
    fireEvent.click(screen.getByRole('button', { name: /copy link/i }))
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://loamy.example/u/kano_agro')
    })
  })

  it('confirms the copy so the click is not silent', async () => {
    setClipboard(async () => {})
    render(<ShareProfile username="sahel_grains" displayName="Sahel Grains" />)
    fireEvent.click(screen.getByRole('button', { name: /copy link/i }))
    // Scoped to the button: the live region announces the same thing, which
    // is correct and would otherwise make this query ambiguous.
    expect(await screen.findByRole('button', { name: /link copied/i })).toBeTruthy()
  })
})

describe('when the clipboard is blocked', () => {
  it('shows the link instead of failing silently', async () => {
    // A dead button is worse than a visible URL somebody can select.
    setClipboard(async () => { throw new Error('blocked') })
    render(<ShareProfile username="sahel_grains" displayName="Sahel Grains" />)
    fireEvent.click(screen.getByRole('button', { name: /copy link/i }))
    const field = await screen.findByLabelText(/profile link/i)
    expect((field as HTMLInputElement).value).toBe('https://loamy.example/u/sahel_grains')
    expect((field as HTMLInputElement).readOnly).toBe(true)
  })
})

describe('with a device share sheet', () => {
  it('uses it, and does not touch the clipboard', async () => {
    const share = vi.fn(async () => {})
    ;(navigator as { share?: unknown }).share = share
    setClipboard(async () => {})
    render(<ShareProfile username="sahel_grains" displayName="Sahel Grains" />)

    const btn = await screen.findByRole('button', { name: /share profile/i })
    fireEvent.click(btn)
    await waitFor(() => expect(share).toHaveBeenCalled())
    expect(share.mock.calls[0][0]).toMatchObject({ url: 'https://loamy.example/u/sahel_grains' })
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
  })

  it('falls back to copying when the sheet is unavailable', async () => {
    ;(navigator as { share?: unknown }).share = vi.fn(async () => { throw new Error('unavailable') })
    setClipboard(async () => {})
    render(<ShareProfile username="sahel_grains" displayName="Sahel Grains" />)
    const btn = await screen.findByRole('button', { name: /share profile/i })
    fireEvent.click(btn)
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled())
  })
})

describe('accessibility', () => {
  it('announces the copy to a screen reader', async () => {
    setClipboard(async () => {})
    const { container } = render(<ShareProfile username="sahel_grains" displayName="Sahel Grains" />)
    fireEvent.click(screen.getByRole('button', { name: /copy link/i }))
    await waitFor(() => {
      const live = container.querySelector('[aria-live="polite"]')
      expect(live?.textContent).toMatch(/copied/i)
    })
  })

  it('uses a real button', () => {
    setClipboard(async () => {})
    render(<ShareProfile username="sahel_grains" displayName="Sahel Grains" />)
    expect(screen.getByRole('button', { name: /copy link/i }).tagName).toBe('BUTTON')
  })
})
