/**
 * Transactions, settlement and financial activity.
 *
 * CUSTODY LANGUAGE
 *   "Loamy does not hold your funds" is a regulatory statement. Every pack must
 *   carry it in full or fall back to English; a shortened translation is not
 *   acceptable. Amounts and the currency never change with language — see
 *   format.ts for why money stays on the Nigerian convention.
 */
export const transaction = {
  'transaction.title': 'Transactions',
  'transaction.transaction': 'Transaction',
  'transaction.reference': 'Reference',
  'transaction.date': 'Date',
  'transaction.amount': 'Amount',
  'transaction.quantity': 'Quantity',
  'transaction.buyer': 'Buyer',
  'transaction.seller': 'Seller',
  'transaction.counterparty': 'Counterparty',

  'transaction.status.proposed': 'Proposed',
  'transaction.status.accepted': 'Accepted',
  'transaction.status.in_progress': 'In progress',
  'transaction.status.delivered': 'Delivered',
  'transaction.status.completed': 'Completed',
  'transaction.status.cancelled': 'Cancelled',
  'transaction.status.disputed': 'Disputed',

  'transaction.payment.unpaid': 'Not paid',
  'transaction.payment.pending': 'Payment pending',
  'transaction.payment.paid': 'Paid',
  'transaction.payment.failed': 'Payment failed',
  'transaction.payment.refunded': 'Refunded',

  'transaction.fulfilment.awaiting': 'Awaiting fulfilment',
  'transaction.fulfilment.loading': 'Loading',
  'transaction.fulfilment.in_transit': 'In transit',
  'transaction.fulfilment.delivered': 'Delivered',

  'transaction.empty': 'No transactions yet',
  'transaction.emptyHint': 'Your purchases and sales appear here once a deal is agreed.',

  /* Order status.
   *
   * Mirrors ORDER_STATUS_META in src/lib/orders.ts word for word; the lib
   * keeps the chip and the state machine, the pack keeps the words, and
   * tests/unit/operations-i18n.test.ts holds the two equal.
   *
   * "In escrow" and "Funds released" are two different facts about where
   * money is, and a translation that blurs them tells a seller they have
   * been paid when they have not. Loamy does not hold either way -- the
   * escrow is a licensed payment partner's -- so neither word may become
   * "Loamy is holding your money".
   */
  // --- one purchase ---------------------------------------------------------
  // The financing block on this page reports the INSTITUTION's position, not
  // Loamy's. "as reported by the institution. Loamy does not compute
  // repayment." is the load-bearing half of that sentence and must survive
  // translation whole.
  'transaction.traceThisPurchase': 'Trace this purchase',
  'transaction.purchaseTotal': 'Purchase total',
  'transaction.payment': 'Payment',
  'transaction.agreement': 'Agreement',
  'transaction.financing': 'Financing',
  'transaction.sandboxDecision': "This decision came from the Loamy sandbox adapter. It simulates an institution's response and moves no money.",
  'transaction.requested': 'Requested',
  'transaction.approved': 'Approved',
  'transaction.settled': 'Settled',
  'transaction.repayment': 'Repayment:',
  'transaction.repaymentTail': '- as reported by the institution. Loamy does not compute repayment.',
  'transaction.settlementWaitingOn': 'Settlement is waiting on:',
  'transaction.payingDirectly': 'Paying directly. You can apply for financing against this purchase instead.',

  // --- order history --------------------------------------------------------
  // "Paystack" is the payment partner's NAME and stays as it is. The sentence
  // around it says the money is with THEM, which is the fact that makes the
  // escrow claim true, so no translation may turn it into "we are holding".
  'transaction.orderHistory': 'Order history',
  'transaction.orderPlaced': 'Your order was placed',
  'transaction.orderPlaced_plural': '{count} orders were placed',
  'transaction.orderPlacedTail': 'and the seller has been notified. You\u2019ll be able to pay securely once it\u2019s confirmed.',
  'transaction.confirmingPayment': 'Thanks - we\u2019re confirming your payment with Paystack. Once confirmed, the order moves into escrow (it may take a few seconds).',
  'transaction.browseMarketplace': 'Browse the marketplace',
  'transaction.subtotal': 'Subtotal',
  'transaction.buyerNote': 'Buyer note:',
  'transaction.sellerNote': 'Seller note:',
  'transaction.legacyOrder': 'This order predates the transaction spine and can no longer be acted on here.',
  'transaction.dismiss': 'Dismiss',
  'transaction.loamyMember': 'Loamy member',

  'transaction.orderStatus.pending_seller': 'Awaiting seller',
  'transaction.orderStatus.confirmed': 'Confirmed',
  'transaction.orderStatus.rejected': 'Declined',
  'transaction.orderStatus.cancelled': 'Cancelled',
  'transaction.orderStatus.awaiting_payment': 'Awaiting payment',
  'transaction.orderStatus.in_escrow': 'In escrow',
  'transaction.orderStatus.released': 'Funds released',
  'transaction.orderStatus.completed': 'Completed',
  'transaction.orderStatus.refunded': 'Refunded',

  'financial.title': 'Financial activity',
  'financial.owedToYou': 'Owed to you',
  'financial.owedToYouSub': 'Once a provider settles',
  'financial.paidDirectly': 'Paid to you directly',
  'financial.paidDirectlySub': 'By a financing institution',
  'financial.custodyNote': 'Loamy does not hold your funds. Owed to you is what a payment partner will settle, and financing is paid to you directly by the institution.',
  'financial.noCustody': 'Loamy does not hold your money.',
  'financial.settledByPartner': 'Settled by a licensed payment partner',
  'financial.empty': 'No financial activity yet',
  'financial.subtitle': 'Every movement recorded against your account on Loamy.',

  // --- where settlement lands ----------------------------------------------
  // BVN and NIN are named national identifiers. They are not translated in
  // any language, and the sentence that says Loamy stores NEITHER is the
  // reason this card can ask for a bank account at all.
  'payout.title': 'Where you get paid',
  'payout.subtitle': "Needed before a buyer's institution can settle you directly for a sale.",
  'payout.bankCode': 'Bank code',
  'payout.bankCodePlaceholder': 'e.g. 058',
  'payout.bankName': 'Bank name',
  'payout.bankNamePlaceholder': 'e.g. GTBank',
  'payout.accountNumber': 'Account number',
  'payout.accountNumberPlaceholder': '10 digits',
  'payout.accountName': 'Account name',
  'payout.accountNamePlaceholder': 'As it appears at the bank',
  'payout.notAnIdentityRecord': 'This is a payout destination, not an identity record. Loamy stores no BVN and no NIN.',
  'financial.owedByYou': 'Owed by you',
  'financial.owedByYouSub': 'Platform fees',
  'financial.movements': 'Movements',
  'financial.loadingActivity': 'Loading activity',
  'financial.emptyBody': 'Movements appear here once you complete a sale, pay a fee, or an institution settles a purchase.',
  'financial.traceReference': 'Trace a reference',
  // Both of these say the same thing twice over on purpose: the money is not
  // Loamy's and never passes through Loamy. A translation that softens either
  // into "we send you your money" is wrong, not merely loose.
  'financial.noteFallback': 'Amounts owed to you are settled by a payment provider or paid to you directly by a financing institution.',
  'financial.settlementNote': 'Settlement reaches you from a payment provider or directly from a financing institution, into the account above. Loamy records the movement; it never holds the funds.',

  /* Ledger event vocabulary.
   *
   * The KEYS on the left of `EVENT_LABEL` are ledger event types written by
   * the database and are part of the data contract. Only the words are
   * looked up; an event type this build has not seen still renders as itself. */
  'financial.event.order_payment': 'Order payment',
  'financial.event.escrow_fund': 'Escrow funded',
  'financial.event.escrow_release': 'Escrow released',
  'financial.event.escrow_refund': 'Escrow refunded',
  'financial.event.fee_charge': 'Platform fee',
  'financial.event.payout': 'Payout',
  'financial.event.payout_reversal': 'Payout reversed',
  'financial.event.adjustment': 'Adjustment',
  'financial.event.settlement': 'Settlement',
} as const
