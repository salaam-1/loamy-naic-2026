import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FeeRuleDialog, type FeeRuleSummary } from '../../src/pages/admin/FeeRuleDialog'

/**
 * The confirmation that would have prevented the incident.
 *
 * On 2026-09-21 a single click ended the ₦2,500 Growth Partner commission for
 * farm verification. The tests here are mostly about what must NOT happen:
 * no mutation without confirmation, no confirmation without a reason, and no
 * possibility of the opening click carrying through to the destructive one.
 */

const onConfirm = vi.fn()
const onCancel = vi.fn()

const commissionRule: FeeRuleSummary = {
  id: 'eabd2420-debd-48dc-a891-e2a70632c849',
  ref: 'FEE-000022',
  scope: 'verification_commission',
  transaction_type: 'farm_verification',
  basis: 'flat',
  value: 2500,
  payer: 'loamy',
  effective_from: '2026-09-20T09:50:49Z',
  effective_to: null,
  active: true,
}

const buyerRule: FeeRuleSummary = {
  ...commissionRule,
  id: 'b-1', ref: 'FEE-000001', scope: 'marketplace_transaction',
  transaction_type: null, basis: 'bps', value: 200, payer: 'split',
}

function open(rule = commissionRule, mode: 'end' | 'restore' = 'end') {
  return render(
    <FeeRuleDialog rule={rule} mode={mode} busy={false} error={null}
      onConfirm={onConfirm} onCancel={onCancel} />,
  )
}

const confirmButton = () => screen.getByRole('button', { name: /end this rule|reinstate this rule/i })
const reasonBox = () => screen.getByLabelText(/why are you/i) as HTMLTextAreaElement

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  onConfirm.mockReset()
  onCancel.mockReset()
})
afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

/** The dialog arms itself 400ms after opening. */
async function arm() {
  await vi.advanceTimersByTimeAsync(450)
}

describe('an accidental click does nothing', () => {
  it('confirms nothing on its own', () => {
    open()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('cannot be confirmed by a double-click landing on the dialog', async () => {
    open()
    // Still inside the arming window: this is the second half of a
    // double-click on "End rule".
    fireEvent.click(confirmButton())
    expect(onConfirm).not.toHaveBeenCalled()
    expect((confirmButton() as HTMLButtonElement).disabled).toBe(true)
  })

  it('stays disabled after arming while there is no reason', async () => {
    open()
    await arm()
    expect((confirmButton() as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(confirmButton())
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('refuses whitespace as a reason', async () => {
    open()
    await arm()
    fireEvent.change(reasonBox(), { target: { value: '   ' } })
    expect((confirmButton() as HTMLButtonElement).disabled).toBe(true)
  })

  it('puts focus on the reason, not on the destructive button', () => {
    open()
    // A stray Enter should type a newline, not end a live fee rule.
    expect(document.activeElement).toBe(reasonBox())
  })

  it('cancels on Escape without confirming', () => {
    open()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })
})

describe('a confirmed action goes through, with its reason', () => {
  it('passes the reason to the caller', async () => {
    open()
    await arm()
    fireEvent.change(reasonBox(), { target: { value: 'Replaced by the agreed commercial rate.' } })
    fireEvent.click(confirmButton())
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('Replaced by the agreed commercial rate.'))
  })

  it('confirms exactly once', async () => {
    open()
    await arm()
    fireEvent.change(reasonBox(), { target: { value: 'Reason.' } })
    fireEvent.click(confirmButton())
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
  })
})

describe('the dialog names what is affected', () => {
  it('shows the reference, the rate and the scope', () => {
    open()
    expect(screen.getByText('FEE-000022')).toBeTruthy()
    expect(screen.getByText('₦2,500 flat')).toBeTruthy()
    expect(screen.getByText(/verification commission/i)).toBeTruthy()
    expect(screen.getByText(/farm verification/i)).toBeTruthy()
  })

  it('shows the effective date', () => {
    open()
    expect(screen.getByText(/in force from/i)).toBeTruthy()
  })

  it('formats a percentage rule as a percentage', () => {
    open(buyerRule)
    expect(screen.getByText('2%')).toBeTruthy()
  })
})

describe('the sentence whose absence caused the incident', () => {
  it('says a payout rule stops a partner being paid', () => {
    open()
    const c = screen.getByTestId('consequence')
    // "End rule" sounds like saving a member money. For a commission it is
    // the opposite, and the old surface never said so.
    expect(c.textContent).toMatch(/pays this out/i)
    expect(c.textContent).toMatch(/paid nothing/i)
  })

  it('does not use that wording for a rule members are charged', () => {
    open(buyerRule)
    const c = screen.getByTestId('consequence')
    expect(c.textContent).not.toMatch(/paid nothing/i)
    expect(c.textContent).toMatch(/buyer and seller/i)
  })

  it('promises reversibility before the act, not after', () => {
    open()
    expect(screen.getByText(/can reinstate this rule afterwards/i)).toBeTruthy()
  })

  it('distinguishes ending from deleting', () => {
    open()
    const text = document.body.textContent ?? ''
    expect(text).toMatch(/end this fee rule/i)
    expect(text).not.toMatch(/\bdelete\b/i)
    expect(text).not.toMatch(/permanently|cannot be undone/i)
  })
})

describe('reinstating explains that it starts a new period', () => {
  it('says a new rule is created rather than the old one reopened', () => {
    open({ ...commissionRule, active: false, effective_to: '2026-09-21T11:30:55Z' }, 'restore')
    expect(screen.getByText(/creates a/i).textContent).toMatch(/new/i)
    expect(screen.getByText(/stay on the record/i)).toBeTruthy()
  })

  it('shows when the rule was ended', () => {
    open({ ...commissionRule, active: false, effective_to: '2026-09-21T11:30:55Z' }, 'restore')
    expect(screen.getByText(/^ended$/i)).toBeTruthy()
  })

  it('does not show the payout warning when reinstating', () => {
    open({ ...commissionRule, active: false, effective_to: '2026-09-21T11:30:55Z' }, 'restore')
    expect(screen.queryByTestId('consequence')).toBeNull()
  })

  it('still requires a reason', async () => {
    open({ ...commissionRule, active: false, effective_to: '2026-09-21T11:30:55Z' }, 'restore')
    await arm()
    expect((confirmButton() as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('a failure is shown and nothing is claimed', () => {
  it('renders the error as an alert', () => {
    render(
      <FeeRuleDialog rule={commissionRule} mode="end" busy={false}
        error="Fee rules are administrative." onConfirm={onConfirm} onCancel={onCancel} />,
    )
    expect(screen.getByRole('alert').textContent).toMatch(/administrative/i)
  })

  it('cannot be cancelled mid-flight', () => {
    render(
      <FeeRuleDialog rule={commissionRule} mode="end" busy error={null}
        onConfirm={onConfirm} onCancel={onCancel} />,
    )
    expect((screen.getByRole('button', { name: /cancel/i }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('the opening double-click cannot dismiss the dialog either', () => {
  it('ignores a backdrop click inside the arming window', () => {
    // Found in browser QA at 768px: the second half of a double-click on
    // "End rule" landed on the backdrop and closed the dialog again. Nothing
    // was mutated, but it flashes open and shut, which invites another click.
    const { container } = open()
    const backdrop = container.querySelector('[role="dialog"]') as HTMLElement
    fireEvent.click(backdrop)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('dismisses on a backdrop click once armed', async () => {
    const { container } = open()
    await arm()
    const backdrop = container.querySelector('[role="dialog"]') as HTMLElement
    fireEvent.click(backdrop)
    expect(onCancel).toHaveBeenCalled()
  })
})
