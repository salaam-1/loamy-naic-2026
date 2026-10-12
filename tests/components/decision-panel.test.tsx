import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ApplicationBundle } from '../../src/lib/bank'

/**
 * The bank decision panel.
 *
 * What is being defended here is mostly NEGATIVE: what the officer must not
 * be offered, and what the applicant must not be told. Those are the failures
 * that matter in a financing UI — a portal that shows Approve on an already
 * approved application, or reports success on a decision the database
 * refused, does real damage.
 */

const recordFinancingDecision = vi.fn()
vi.mock('@/lib/bankDecision', () => ({
  recordFinancingDecision: (...args: unknown[]) => recordFinancingDecision(...args),
}))

const { DecisionPanel } = await import('../../src/pages/bank/DecisionPanel')

function bundleWith(over: Partial<ApplicationBundle['application']> = {}, rest: Partial<ApplicationBundle> = {}) {
  return {
    application: {
      id: 'app-1', ref: 'FIN-000123',
      product_type: 'commodity_purchase', structure: 'murabaha',
      amount_requested: 9_000_000, approved_amount: null, disbursed_amount: 0,
      purpose: 'Purchase of 100 tonne Maize', intended_items: [],
      disbursement_preference: 'supplier_payment',
      status: 'submitted', status_history: [], decision_note: null,
      conditions: null, tenor_days: null, pricing_note: null,
      bank_reference: null, expires_at: null, decided_at: null,
      decision_source: null, is_sandbox: false, repayment_status: null,
      submitted_at: '2026-09-20T10:00:00Z', updated_at: '2026-09-20T10:00:00Z',
      ...over,
    },
    transaction: null,
    bank: {
      name: 'Partner Bank', ref: 'BNK-000014',
      integration_mode: 'live', is_sandbox: false, supports_supplier_direct: true,
    },
    permitted_decisions: ['under_review', 'additional_information_required', 'approved', 'partially_approved', 'rejected'],
    events: [],
    identity: null, farms: [], activity: { active_listings: 0, concluded_deals: 0, onboarded_by_partner: false },
    financing_context: { prior_applications: [], milestones: [] },
    ...rest,
  } as unknown as ApplicationBundle
}

const onDecided = vi.fn()

beforeEach(() => {
  recordFinancingDecision.mockReset()
  recordFinancingDecision.mockResolvedValue({ ok: true })
  onDecided.mockReset()
})
afterEach(cleanup)

const approveButton = () => screen.getByRole('button', { name: /^approve$/i })

describe('the offered actions come from the server', () => {
  it('offers approve and decline when the server permits them', () => {
    render(<DecisionPanel bundle={bundleWith()} onDecided={onDecided} />)
    expect(approveButton()).toBeTruthy()
    expect(screen.getByRole('button', { name: /decline/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /request information/i })).toBeTruthy()
  })

  it('offers NOTHING on an already approved application', () => {
    // The server returns an empty permitted_decisions for a decided
    // application. The panel must not invent one back.
    render(<DecisionPanel
      bundle={bundleWith({ status: 'approved', approved_amount: 9_000_000 }, { permitted_decisions: [] })}
      onDecided={onDecided} />)
    expect(screen.queryByRole('button', { name: /^approve$/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /decline/i })).toBeNull()
    expect(screen.getByText(/no decision is open/i)).toBeTruthy()
  })

  it.each(['rejected', 'expired', 'cancelled', 'disbursed', 'completed', 'decided_external'])(
    'offers nothing on a %s application', (status) => {
      render(<DecisionPanel
        bundle={bundleWith({ status }, { permitted_decisions: [] })}
        onDecided={onDecided} />)
      expect(screen.queryByRole('button', { name: /^approve$/i })).toBeNull()
    })

  it('offers nothing at all when the server sent no list', () => {
    render(<DecisionPanel
      bundle={bundleWith({}, { permitted_decisions: undefined as unknown as string[] })}
      onDecided={onDecided} />)
    expect(screen.queryByRole('button', { name: /^approve$/i })).toBeNull()
  })

  it('offers only what the server named, even when it names one', () => {
    render(<DecisionPanel
      bundle={bundleWith({ status: 'under_review' }, { permitted_decisions: ['rejected'] })}
      onDecided={onDecided} />)
    expect(screen.getByRole('button', { name: /decline/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^approve$/i })).toBeNull()
  })
})

describe('the approval amount', () => {
  it('pre-fills with what was requested, and nothing else', () => {
    render(<DecisionPanel bundle={bundleWith()} onDecided={onDecided} />)
    fireEvent.click(approveButton())
    expect((screen.getByLabelText(/approved amount/i) as HTMLInputElement).value).toBe('9000000')
  })

  it('refuses more than was requested, before any round trip', async () => {
    render(<DecisionPanel bundle={bundleWith()} onDecided={onDecided} />)
    fireEvent.click(approveButton())
    fireEvent.change(screen.getByLabelText(/approved amount/i), { target: { value: '9000001' } })
    expect(screen.getByText(/cannot exceed/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /record approve/i }))
    await waitFor(() => expect(recordFinancingDecision).not.toHaveBeenCalled())
  })

  it('offers no ladder, tier or preset figure', () => {
    render(<DecisionPanel bundle={bundleWith()} onDecided={onDecided} />)
    fireEvent.click(approveButton())
    // A "₦100k / ₦250k / ₦500k" picker is exactly what must not exist.
    for (const preset of [/₦100,000/, /₦250,000/, /₦500,000/, /₦1,000,000/]) {
      expect(screen.queryByText(preset)).toBeNull()
    }
    expect(screen.queryByRole('radio')).toBeNull()
  })

  it('sends the approved amount through to the authoritative function', async () => {
    render(<DecisionPanel bundle={bundleWith()} onDecided={onDecided} />)
    fireEvent.click(approveButton())
    fireEvent.change(screen.getByLabelText(/approved amount/i), { target: { value: '6000000' } })
    fireEvent.change(screen.getByLabelText(/tenor/i), { target: { value: '90' } })
    fireEvent.change(screen.getByLabelText(/your reference/i), { target: { value: 'PB-2026-88' } })
    fireEvent.click(screen.getByRole('button', { name: /record approve/i }))
    await waitFor(() => expect(recordFinancingDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationId: 'app-1', decision: 'approved',
        approvedAmount: 6_000_000, tenorDays: 90, bankReference: 'PB-2026-88',
      }),
    ))
  })
})

describe('the client cannot name the actor, the bank or the status', () => {
  it('sends no actor, bank, applicant, status or provenance', async () => {
    render(<DecisionPanel bundle={bundleWith()} onDecided={onDecided} />)
    fireEvent.click(approveButton())
    fireEvent.click(screen.getByRole('button', { name: /record approve/i }))
    await waitFor(() => expect(recordFinancingDecision).toHaveBeenCalled())
    const sent = recordFinancingDecision.mock.calls[0][0] as Record<string, unknown>
    // Each of these is derived server-side. A key here would be a way in.
    for (const forbidden of [
      'actor', 'actorId', 'reviewedBy', 'bankId', 'bank',
      'applicantId', 'status', 'source', 'decisionSource', 'isSandbox',
      'transactionId', 'sellerId', 'amountRequested',
    ]) {
      expect(sent, forbidden).not.toHaveProperty(forbidden)
    }
  })
})

describe('a failed decision is visible, and never reported as success', () => {
  it('shows the server’s refusal', async () => {
    recordFinancingDecision.mockResolvedValue({
      ok: false, error: 'Only the assigned bank can decide this application.',
    })
    render(<DecisionPanel bundle={bundleWith()} onDecided={onDecided} />)
    fireEvent.click(approveButton())
    fireEvent.click(screen.getByRole('button', { name: /record approve/i }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/only the assigned bank/i)
  })

  it('does not refresh as though the decision landed', async () => {
    recordFinancingDecision.mockResolvedValue({ ok: false, error: 'nope' })
    render(<DecisionPanel bundle={bundleWith()} onDecided={onDecided} />)
    fireEvent.click(approveButton())
    fireEvent.click(screen.getByRole('button', { name: /record approve/i }))
    await screen.findByRole('alert')
    expect(onDecided).not.toHaveBeenCalled()
  })

  it('keeps what the officer typed', async () => {
    recordFinancingDecision.mockResolvedValue({ ok: false, error: 'nope' })
    render(<DecisionPanel bundle={bundleWith()} onDecided={onDecided} />)
    fireEvent.click(approveButton())
    fireEvent.change(screen.getByLabelText(/approved amount/i), { target: { value: '4500000' } })
    fireEvent.change(screen.getByLabelText(/note to the applicant/i), { target: { value: 'Subject to inspection' } })
    fireEvent.click(screen.getByRole('button', { name: /record approve/i }))
    await screen.findByRole('alert')
    expect((screen.getByLabelText(/approved amount/i) as HTMLInputElement).value).toBe('4500000')
    expect((screen.getByLabelText(/note to the applicant/i) as HTMLTextAreaElement).value)
      .toBe('Subject to inspection')
  })

  it('refreshes only on a real success', async () => {
    render(<DecisionPanel bundle={bundleWith()} onDecided={onDecided} />)
    fireEvent.click(approveButton())
    fireEvent.click(screen.getByRole('button', { name: /record approve/i }))
    await waitFor(() => expect(onDecided).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('a refusal and a question need words', () => {
  it('will not decline with an empty reason', async () => {
    render(<DecisionPanel bundle={bundleWith()} onDecided={onDecided} />)
    fireEvent.click(screen.getByRole('button', { name: /decline/i }))
    const submit = screen.getByRole('button', { name: /record decline/i }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.click(submit)
    await waitFor(() => expect(recordFinancingDecision).not.toHaveBeenCalled())
  })

  it('will not ask for information without saying what is needed', async () => {
    render(<DecisionPanel bundle={bundleWith()} onDecided={onDecided} />)
    fireEvent.click(screen.getByRole('button', { name: /request information/i }))
    const submit = screen.getByRole('button', { name: /record request information/i }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
  })

  it('sends the reason through on a decline', async () => {
    render(<DecisionPanel bundle={bundleWith()} onDecided={onDecided} />)
    fireEvent.click(screen.getByRole('button', { name: /decline/i }))
    fireEvent.change(screen.getByLabelText(/message to the applicant/i), {
      target: { value: 'Outside our current commodity exposure.' },
    })
    fireEvent.click(screen.getByRole('button', { name: /record decline/i }))
    await waitFor(() => expect(recordFinancingDecision).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'rejected', note: 'Outside our current commodity exposure.' }),
    ))
  })

  it('never sends an approval amount with a decline', async () => {
    render(<DecisionPanel bundle={bundleWith()} onDecided={onDecided} />)
    fireEvent.click(screen.getByRole('button', { name: /decline/i }))
    fireEvent.change(screen.getByLabelText(/message to the applicant/i), { target: { value: 'No.' } })
    fireEvent.click(screen.getByRole('button', { name: /record decline/i }))
    await waitFor(() => expect(recordFinancingDecision).toHaveBeenCalled())
    expect((recordFinancingDecision.mock.calls[0][0] as { approvedAmount: unknown }).approvedAmount).toBeNull()
  })
})

describe('sandbox is declared before the officer decides', () => {
  it('warns when the institution is in sandbox mode', () => {
    render(<DecisionPanel
      bundle={bundleWith({}, { bank: { name: 'B', ref: 'BNK-1', integration_mode: 'sandbox', is_sandbox: true, supports_supplier_direct: false } } as Partial<ApplicationBundle>)}
      onDecided={onDecided} />)
    const warning = screen.getByTestId('sandbox-warning')
    expect(warning.textContent).toMatch(/test data/i)
    expect(warning.textContent).toMatch(/not a credit decision/i)
  })

  it('does not call a live integration a simulation', () => {
    render(<DecisionPanel bundle={bundleWith()} onDecided={onDecided} />)
    expect(screen.queryByTestId('sandbox-warning')).toBeNull()
    expect(screen.getByText(/live mode/i)).toBeTruthy()
  })

  it('shows the warning before the form is even opened', () => {
    render(<DecisionPanel
      bundle={bundleWith({}, { bank: { name: 'B', ref: 'BNK-1', integration_mode: 'sandbox', is_sandbox: true, supports_supplier_direct: false } } as Partial<ApplicationBundle>)}
      onDecided={onDecided} />)
    // Not a footnote discovered after recording a simulated approval.
    expect(screen.getByTestId('sandbox-warning')).toBeTruthy()
    expect(screen.queryByLabelText(/approved amount/i)).toBeNull()
  })
})

describe('no prohibited personal data is collected', () => {
  it('asks for no BVN and no NIN anywhere in the decision form', () => {
    const { container } = render(<DecisionPanel bundle={bundleWith()} onDecided={onDecided} />)
    fireEvent.click(approveButton())
    const text = container.textContent ?? ''
    expect(text).not.toMatch(/\bBVN\b/i)
    expect(text).not.toMatch(/\bNIN\b/i)
    expect(text).not.toMatch(/account number/i)
    expect(container.querySelector('input[name*="bvn" i]')).toBeNull()
    expect(container.querySelector('input[name*="nin" i]')).toBeNull()
  })
})
