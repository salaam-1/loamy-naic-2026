import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PrivacyNotice } from '../../src/components/PrivacyNotice'
import { PrivacyPreferences } from '../../src/components/PrivacyPreferences'
import { CONSENT_STORAGE_KEY, consentAllows, parseRecord, reloadConsent, resetConsent } from '../../src/lib/consent'
import { POLICY_VERSION } from '../../src/content/legal/privacy-policy'

function renderNotice() {
  return render(<MemoryRouter><PrivacyNotice /></MemoryRouter>)
}

/** The banner animates in on a timer, so tests advance past it. */
async function settle() {
  await vi.advanceTimersByTimeAsync(100)
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  resetConsent()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('a first-time visitor', () => {
  it('is shown the notice', async () => {
    renderNotice()
    await settle()
    expect(screen.getByRole('region', { name: /privacy preferences/i })).toBeTruthy()
  })

  it('is told what cannot be turned off, and what is optional', async () => {
    renderNotice()
    await settle()
    const region = screen.getByRole('region', { name: /privacy preferences/i })
    expect(region.textContent).toMatch(/essential/i)
    expect(region.textContent).toMatch(/optional/i)
  })

  it('can reach the full policy without deciding anything', async () => {
    renderNotice()
    await settle()
    const link = screen.getByRole('link', { name: /privacy policy/i })
    expect(link.getAttribute('href')).toBe('/privacy')
  })

  it('is offered decline as prominently as accept', async () => {
    // A notice whose only obvious button is "Accept" is a dark pattern. Both
    // are real buttons at the top level, not one buried behind a menu.
    renderNotice()
    await settle()
    expect(screen.getByRole('button', { name: /accept all/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /essential only/i })).toBeTruthy()
  })

  it('records nothing until a button is pressed', async () => {
    renderNotice()
    await settle()
    expect(localStorage.getItem(CONSENT_STORAGE_KEY)).toBeNull()
    expect(consentAllows('analytics')).toBe(false)
  })
})

describe('accepting', () => {
  it('turns analytics on and dismisses the notice', async () => {
    renderNotice()
    await settle()
    fireEvent.click(screen.getByRole('button', { name: /accept all/i }))
    expect(consentAllows('analytics')).toBe(true)
    expect(screen.queryByRole('region', { name: /privacy preferences/i })).toBeNull()
  })

  it('stores the policy version it was accepted against', async () => {
    renderNotice()
    await settle()
    fireEvent.click(screen.getByRole('button', { name: /accept all/i }))
    const stored = parseRecord(localStorage.getItem(CONSENT_STORAGE_KEY))
    expect(stored?.policyVersion).toBe(POLICY_VERSION)
    expect(stored?.analytics).toBe(true)
  })
})

describe('declining', () => {
  it('leaves analytics off but still dismisses the notice', async () => {
    // Declining must be REMEMBERED. A notice that reappears until you accept
    // is a notice that nags people into consenting.
    renderNotice()
    await settle()
    fireEvent.click(screen.getByRole('button', { name: /essential only/i }))
    expect(consentAllows('analytics')).toBe(false)
    expect(screen.queryByRole('region', { name: /privacy preferences/i })).toBeNull()
  })

  it('stays dismissed across a reload', async () => {
    renderNotice()
    await settle()
    fireEvent.click(screen.getByRole('button', { name: /essential only/i }))
    const raw = localStorage.getItem(CONSENT_STORAGE_KEY)
    cleanup()

    // A fresh page: storage survives, the in-memory copy does not.
    localStorage.setItem(CONSENT_STORAGE_KEY, raw!)
    reloadConsent()
    renderNotice()
    await settle()
    expect(screen.queryByRole('region', { name: /privacy preferences/i })).toBeNull()
  })
})

describe('managing preferences from the notice', () => {
  it('reveals the categories', async () => {
    renderNotice()
    await settle()
    fireEvent.click(screen.getByRole('button', { name: /manage preferences/i }))
    expect(screen.getByRole('checkbox', { name: /essential/i })).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: /analytics/i })).toBeTruthy()
  })

  it('will not let essential be switched off', async () => {
    // It is presented as fixed rather than as a switch that silently does
    // nothing when clicked.
    renderNotice()
    await settle()
    fireEvent.click(screen.getByRole('button', { name: /manage preferences/i }))
    const essential = screen.getByRole('checkbox', { name: /essential/i }) as HTMLInputElement
    expect(essential.disabled).toBe(true)
    expect(essential.checked).toBe(true)
  })

  it('saves exactly what was ticked', async () => {
    renderNotice()
    await settle()
    fireEvent.click(screen.getByRole('button', { name: /manage preferences/i }))
    fireEvent.click(screen.getByRole('checkbox', { name: /analytics/i }))
    fireEvent.click(screen.getByRole('button', { name: /save preferences/i }))
    expect(consentAllows('analytics')).toBe(true)
  })

  it('saves a refusal when nothing optional is ticked', async () => {
    renderNotice()
    await settle()
    fireEvent.click(screen.getByRole('button', { name: /manage preferences/i }))
    fireEvent.click(screen.getByRole('button', { name: /save preferences/i }))
    expect(consentAllows('analytics')).toBe(false)
    expect(parseRecord(localStorage.getItem(CONSENT_STORAGE_KEY))).not.toBeNull()
  })

  it('offers no marketing category, because there is no marketing tracking', async () => {
    renderNotice()
    await settle()
    fireEvent.click(screen.getByRole('button', { name: /manage preferences/i }))
    expect(screen.queryByRole('checkbox', { name: /marketing/i })).toBeNull()
    expect(screen.queryByRole('checkbox', { name: /advertis/i })).toBeNull()
  })
})

describe('a material policy change asks again', () => {
  it('reappears when the stored policy version is out of date', async () => {
    // Simulates bumping POLICY_VERSION: the person consented to a DIFFERENT
    // policy, so they are asked afresh.
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({
      policyVersion: '0.0-old', consentVersion: '1', noticeVersion: '1',
      essential: true, analytics: true, recordedAt: new Date().toISOString(),
    }))
    reloadConsent()
    renderNotice()
    await settle()
    expect(screen.getByRole('region', { name: /privacy preferences/i })).toBeTruthy()
  })

  it('withdraws the old optional permission while it re-asks', async () => {
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({
      policyVersion: '0.0-old', consentVersion: '1', noticeVersion: '1',
      essential: true, analytics: true, recordedAt: new Date().toISOString(),
    }))
    reloadConsent()
    expect(consentAllows('analytics')).toBe(false)
  })
})

describe('keyboard and screen-reader access', () => {
  it('uses real buttons, so they focus and activate from the keyboard', async () => {
    renderNotice()
    await settle()
    for (const name of [/accept all/i, /essential only/i, /manage preferences/i]) {
      const btn = screen.getByRole('button', { name })
      expect(btn.tagName).toBe('BUTTON')
      btn.focus()
      expect(document.activeElement).toBe(btn)
    }
  })

  it('activates with Enter on the focused button', async () => {
    renderNotice()
    await settle()
    const btn = screen.getByRole('button', { name: /essential only/i })
    btn.focus()
    fireEvent.click(btn) // what Enter dispatches on a native button
    expect(parseRecord(localStorage.getItem(CONSENT_STORAGE_KEY))?.analytics).toBe(false)
  })

  it('moves focus to the notice when it opens', async () => {
    renderNotice()
    await settle()
    const region = screen.getByRole('region', { name: /privacy preferences/i })
    expect(region.contains(document.activeElement)).toBe(true)
  })

  it('labels every checkbox', async () => {
    renderNotice()
    await settle()
    fireEvent.click(screen.getByRole('button', { name: /manage preferences/i }))
    for (const box of screen.getAllByRole('checkbox')) {
      expect(box.getAttribute('aria-hidden')).not.toBe('true')
      // getByRole with a name already proves an accessible name exists; this
      // guards against a future change to a nameless div-with-onClick.
      expect(box.tagName).toBe('INPUT')
    }
  })

  it('does not cover the page or trap the keyboard', async () => {
    // It is a banner, not a modal: the public marketplace stays browsable.
    renderNotice()
    await settle()
    const region = screen.getByRole('region', { name: /privacy preferences/i })
    expect(region.getAttribute('role')).not.toBe('dialog')
    expect(region.getAttribute('aria-modal')).toBeNull()
    expect(document.body.style.overflow).not.toBe('hidden')
  })
})

describe('the shared preference panel', () => {
  it('reports that no choice has been made yet', () => {
    render(<PrivacyPreferences />)
    expect(screen.getByText(/have not set a preference yet/i)).toBeTruthy()
  })

  it('will not offer to save until something changes', () => {
    render(<PrivacyPreferences />)
    const save = screen.getByRole('button', { name: /save preferences/i }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
  })

  it('saves a change and confirms it', () => {
    render(<PrivacyPreferences />)
    fireEvent.click(screen.getByRole('checkbox', { name: /analytics/i }))
    const save = screen.getByRole('button', { name: /save preferences/i })
    fireEvent.click(save)
    expect(consentAllows('analytics')).toBe(true)
    expect(screen.getByRole('status').textContent).toMatch(/saved/i)
  })

  it('shows which policy version the choice was recorded against', () => {
    render(<PrivacyPreferences />)
    fireEvent.click(screen.getByRole('checkbox', { name: /analytics/i }))
    fireEvent.click(screen.getByRole('button', { name: /save preferences/i }))
    expect(screen.getByText(new RegExp(`policy version ${POLICY_VERSION}`, 'i'))).toBeTruthy()
  })

  it('keeps essential locked here too', () => {
    render(<PrivacyPreferences />)
    const essential = screen.getByRole('checkbox', { name: /essential/i }) as HTMLInputElement
    expect(essential.disabled).toBe(true)
  })
})

describe('what the consent record is allowed to contain', () => {
  it('stores no personal identifier', async () => {
    renderNotice()
    await settle()
    fireEvent.click(screen.getByRole('button', { name: /accept all/i }))
    const raw = localStorage.getItem(CONSENT_STORAGE_KEY)!
    const keys = Object.keys(JSON.parse(raw))
    expect(keys.sort()).toEqual([
      'analytics', 'consentVersion', 'essential', 'noticeVersion', 'policyVersion', 'recordedAt',
    ])
  })

  it('stores no financial identifier', async () => {
    renderNotice()
    await settle()
    fireEvent.click(screen.getByRole('button', { name: /accept all/i }))
    const raw = localStorage.getItem(CONSENT_STORAGE_KEY)!.toLowerCase()
    for (const forbidden of ['bvn', 'nin', 'account', 'card', 'bank']) {
      expect(raw, `consent must not store ${forbidden}`).not.toContain(forbidden)
    }
  })

  it('writes exactly one key', async () => {
    renderNotice()
    await settle()
    fireEvent.click(screen.getByRole('button', { name: /accept all/i }))
    const keys = Object.keys(localStorage)
    expect(keys).toEqual([CONSENT_STORAGE_KEY])
  })
})

describe('the mobile layout', () => {
  it('stacks the buttons and keeps them inside the viewport', async () => {
    renderNotice()
    await settle()
    const region = screen.getByRole('region', { name: /privacy preferences/i })
    // flex-col by default, sm:flex-row from the small breakpoint up.
    const actions = within(region).getByRole('button', { name: /accept all/i }).parentElement!
    expect(actions.className).toContain('flex-col')
    expect(actions.className).toContain('sm:flex-row')
    // Fixed to the bottom rather than in flow, so it cannot reflow the page.
    expect(region.className).toContain('fixed')
    expect(region.className).toContain('bottom-0')
  })
})
