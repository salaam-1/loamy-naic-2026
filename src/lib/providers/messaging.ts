/**
 * MESSAGING PROVIDER SEAM — SMS, WhatsApp, email.
 *
 * NOT IMPLEMENTED, AND NOT CURRENTLY USED.
 *
 * Loamy notifies members through the `notifications` table, read in-app. That
 * is deliberate and it works offline-ish: a farmer opens the app and sees
 * what changed. Nothing in the product sends an SMS today, and this seam
 * exists so that when one is needed — a bank asking for a document, a
 * verification agent being dispatched, an approval landing — it plugs in
 * without a notification system growing a second spine.
 *
 * THREE RULES A CONCRETE ADAPTER MUST HOLD
 *
 * 1. THE DATABASE STAYS AUTHORITATIVE. An outbound message is a COPY of a
 *    `notifications` row, never a substitute for one. If the gateway is down,
 *    the member still sees it in the app. A message that exists only in an
 *    SMS is a message Loamy cannot show, audit or resend.
 *
 * 2. NO SENSITIVE CONTENT LEAVES. An SMS is unencrypted, lands on a lock
 *    screen and is retained by a carrier. So: no financing amounts, no
 *    account digits, no identity data, no verification-agent identity, no
 *    counterparty contact details. A notification tells someone that
 *    something changed and to open Loamy. It does not tell them what.
 *
 * 3. CONSENT IS CHECKED BEFORE SENDING, not after. Phone numbers were
 *    collected for account use, and a marketing blast to them would be both
 *    a legal problem and a betrayal. `purpose` below is mandatory for that
 *    reason — the adapter must be able to distinguish transactional from
 *    anything else, and refuse the latter without an explicit opt-in.
 */
import {
  NOT_CONFIGURED,
  type Idempotent, type ProviderInfo, type ProviderResult,
} from '@/lib/providers/types'

export type MessageChannel = 'sms' | 'whatsapp' | 'email'

/**
 * Why this message is being sent.
 *
 * `transactional` is something the member asked for by using the product.
 * `service` is an operational notice about their own account. Anything else
 * needs an opt-in this codebase does not currently collect, which is why
 * there is no `marketing` value here to reach for.
 */
export type MessagePurpose = 'transactional' | 'service'

export interface OutboundMessage extends Idempotent {
  channel: MessageChannel
  /** E.164 for sms/whatsapp; an address for email. */
  to: string
  purpose: MessagePurpose
  /**
   * The notification this mirrors. Keeps the in-app record authoritative and
   * makes a delivery receipt traceable back to what it was about.
   */
  notificationId?: string
  /**
   * Pre-approved template key. Free text is deliberately not accepted:
   * WhatsApp requires registered templates, and a template list is something
   * a reviewer can read in full before anything is sent to a real person.
   */
  templateKey: string
  /**
   * Template variables. These MUST NOT contain amounts, account digits,
   * identity data or a counterparty's contact details — see rule 2.
   */
  variables?: Record<string, string>
  /** Falls back to the member's stored language. */
  language?: string
}

export interface DeliveryReceipt {
  accepted: boolean
  externalId?: string
  /** The provider's word, not a guarantee. 'sent' is not 'read'. */
  status: 'queued' | 'sent' | 'delivered' | 'failed' | 'unknown'
  reason?: string
}

export interface MessagingProvider {
  readonly info: ProviderInfo
  send(msg: OutboundMessage): Promise<ProviderResult<DeliveryReceipt>>
  /** Which channels this provider can actually deliver. */
  supports(channel: MessageChannel): boolean
}

export const noMessagingProvider: MessagingProvider = {
  info: { key: 'none', label: 'No messaging provider', mode: 'disabled' },
  supports: () => false,
  async send() {
    return { ok: false, error: NOT_CONFIGURED }
  },
}

/**
 * A sandbox that DELIVERS NOTHING and says so.
 *
 * It records what would have been sent so a workflow can be exercised, and
 * every receipt carries a `SANDBOX-` id. It must never be registered in an
 * environment with real member phone numbers where someone might read the log
 * as evidence that a message arrived.
 */
export const sandboxMessagingProvider: MessagingProvider = {
  info: { key: 'sandbox', label: 'Sandbox (no delivery)', mode: 'sandbox' },
  supports: () => true,
  async send(msg) {
    return {
      ok: true, mode: 'sandbox',
      value: {
        accepted: true,
        externalId: `SANDBOX-MSG-${msg.idempotencyKey}`,
        status: 'queued',
        reason: 'Simulated. Nothing was sent and no gateway was contacted.',
      },
    }
  },
}

let active: MessagingProvider = noMessagingProvider

export function setMessagingProvider(p: MessagingProvider): void {
  active = p
}

export function messagingProvider(): MessagingProvider {
  return active
}
