/**
 * Financing.
 *
 * COMPLIANCE COPY IS NOT ORDINARY COPY
 *   Several strings here are assurances, not descriptions: Loamy is not a
 *   lender, decisions belong to the partner bank, a sandbox decision commits no
 *   funds. A translation of these must preserve every clause. Where a target
 *   language cannot carry the distinction reliably, the English must stand
 *   rather than a weaker paraphrase — that is a deliberate rule in
 *   glossary.md, not an oversight.
 *
 *   Bank names are DATA. They are interpolated, never translated.
 */
export const financing = {
  'financing.title': 'Financing',
  'financing.apply': 'Apply for financing',
  'financing.applyAgain': 'Apply again',
  // The card's own button, next to a heading that already says what it is.
  'financing.applyShort': 'Apply',
  'financing.amountRequested': 'Amount requested',
  'financing.purpose': 'Purpose',
  'financing.structure': 'Structure',
  'financing.partnerBank': 'Partner bank',
  'financing.application': 'Application',
  'financing.applications': 'Applications',
  'financing.facility': 'Facility',
  'financing.principal': 'Principal',
  'financing.repayments': 'Repayments',
  'financing.disbursements': 'Disbursements',
  'financing.collateral': 'Collateral',
  'financing.nextRepayment': 'Next repayment',
  'financing.outstanding': 'Outstanding',

  /* Decision states.
   *
   * THESE MUST MATCH `FINANCING_STATUS_META` WORD FOR WORD.
   *   That map in src/lib/financingLifecycle.ts is the single presentation
   *   contract for the lifecycle, and it is what renders today. These keys are
   *   the TRANSLATION layer over it, not a second opinion about the English:
   *   if the two disagree, an English reader sees one word on one screen and
   *   a different word on the next, depending only on which surface happens to
   *   have been wired to i18n. tests/unit/financing-i18n.test.ts asserts the
   *   parity, so a wording change in either place fails until both agree.
   *
   * All thirteen values the check constraint permits are present, including
   * the two spellings of "the bank asked a question", which are live in the
   * data and must both render.
   */
  'financing.status.draft': 'Draft',
  'financing.status.submitted': 'Submitted',
  'financing.status.under_review': 'Under review',
  'financing.status.info_requested': 'Information requested',
  'financing.status.additional_information_required': 'Information requested',
  'financing.status.approved': 'Approved',
  'financing.status.partially_approved': 'Partially approved',
  'financing.status.rejected': 'Declined',
  'financing.status.expired': 'Expired',
  'financing.status.cancelled': 'Withdrawn',
  'financing.status.disbursed': 'Settled',
  'financing.status.completed': 'Completed',
  'financing.status.decided_external': 'Decided outside Loamy',

  /* What each state means TO THE APPLICANT, in the second person. These are
   * the `applicant` strings from the same map and carry the same parity rule.
   * Every one of them attributes the action to the institution, never to
   * Loamy, which is the whole point of the wording. */
  'financing.statusHint.draft': 'Not submitted yet - continue where you left off.',
  'financing.statusHint.submitted': 'Received. Your application is with the institution.',
  'financing.statusHint.under_review': 'The institution is reviewing your application.',
  'financing.statusHint.info_requested': 'The institution has asked for more information.',
  'financing.statusHint.additional_information_required': 'The institution has asked for more information.',
  'financing.statusHint.approved': 'The institution approved your application.',
  'financing.statusHint.partially_approved': 'The institution approved part of what you asked for.',
  'financing.statusHint.rejected': 'The institution declined this application.',
  'financing.statusHint.expired': 'The approval expired before it was used.',
  'financing.statusHint.cancelled': 'This application was withdrawn.',
  'financing.statusHint.disbursed': 'The institution has settled this facility.',
  'financing.statusHint.completed': 'This facility is closed.',
  'financing.statusHint.decided_external': 'The institution decided and communicates the outcome to you directly.',
  'financing.statusHint.unknown': 'This application is in a state Loamy does not recognise.',

  'financing.approved': 'Approved',
  'financing.rejected': 'Declined',
  'financing.awaitingDecision': 'Waiting on the partner bank',
  'financing.decisionBy': 'Decided by {bank}',

  // assurances
  'financing.notALender': 'Loamy is not a lender. Financing decisions are made by partner banks.',
  'financing.decisionIsBanks': 'The partner bank makes this decision, not Loamy.',
  'financing.sandboxWarning': 'Sandbox mode: this is test data, not a credit decision, and commits no funds. The applicant sees it labelled as a simulation.',
  'financing.sandboxBadge': 'Simulation',
  'financing.noPlatformCap': 'Loamy sets no cap on what you may ask for. The bank decides.',

  'financing.empty': 'No financing applications yet',
  'financing.emptyHint': 'Apply when you need input finance or working capital for a season.',
  'financing.applySuccess': 'Your application has been sent to the partner bank.',
  'financing.applyFailed': 'We could not send your application.',
  'financing.activateFacility': 'Activate facility',
  'financing.facilityOpened': 'Facility opened',

  // --- the product card on the financing home ------------------------------
  // `Murabaha` is a named contract structure, not a description. It is listed
  // in glossary.md as do-not-translate: rendering it as "cost-plus sale" in
  // another language would describe the product but stop naming it, and a
  // member asking their bank about it needs the name the bank uses.
  'financing.product.inputFinancing': 'Input Financing',
  'financing.product.murabahaLine': 'Murabaha (cost-plus, non-interest)',
  'financing.product.murabahaShort': 'Murabaha (non-interest)',
  'financing.product.blurb': 'Finance seeds, fertilizer, and other inputs through a partner bank on a Shariah-compliant, non-interest basis. You apply here with your farm profile; the bank makes the decision and handles all money - Loamy never holds funds.',

  // --- financing home ------------------------------------------------------
  'financing.latestProgress': 'Latest application progress',
  'financing.myFacilities': 'My facilities',
  'financing.myApplications': 'My applications',
  'financing.loadingApplications': 'Loading applications',
  'financing.noApplicationsYet': 'No applications yet. When you apply, you can track its progress here at every step.',
  'financing.facilitiesNote': 'Disbursements and repayments are handled by your bank on its own rails; Loamy records them here for your history.',
  'financing.discardDraft': 'Discard draft',
  'financing.continueDraft': 'Continue',
  'financing.stage.decisionCommunicated': 'Decision communicated',

  // --- the application form ------------------------------------------------
  // Every line that touches money attributes the act to the partner bank.
  // "the bank disburses", never "we disburse"; "the bank decides", never
  // "your application is approved". A translation that loses the agent loses
  // the only thing these sentences are for.
  'financing.apply.heading': 'Input Financing application',
  'financing.apply.subtitle': 'Murabaha (cost-plus, non-interest) \u00b7 decided by the partner bank',
  'financing.apply.stepsAria': 'Application steps',
  'financing.apply.step.farm': 'Farm',
  'financing.apply.step.amountPurpose': 'Amount & purpose',
  'financing.apply.step.items': 'Items',
  'financing.apply.step.disbursement': 'Disbursement',
  'financing.apply.step.review': 'Review',

  'financing.apply.whichFarm': 'Which farm is this for?',
  'financing.apply.notFarmSpecific': 'Not farm-specific / general inputs',
  'financing.apply.notFarmSpecificShort': 'Not farm-specific',
  'financing.apply.noFarmsWarning': 'You have no registered farms yet. You can still apply, but a registered (and later verified) farm significantly strengthens your application with the bank.',

  'financing.apply.amountLabel': 'Amount requested (\u20a6) *',
  'financing.apply.amountPlaceholder': 'e.g. 150000',
  'financing.apply.amountInvalid': 'Enter an amount greater than zero.',
  'financing.apply.amountHint': 'State the full amount you need - the partner bank decides what it can offer.',
  'financing.apply.purposeLabel': 'What is the financing for? *',
  'financing.apply.purposePlaceholder': 'e.g. Fertilizer and improved seed for the 2027 maize season',

  'financing.apply.intendedItems': 'Intended items',
  'financing.apply.addItem': 'Add item',
  'financing.apply.itemsHint': 'List the inputs you intend to buy (e.g. \u201cNPK Fertilizer - 10 bags\u201d). Optional, but it helps the bank process your application faster.',
  'financing.apply.itemPlaceholder': 'Item - e.g. NPK Fertilizer',
  'financing.apply.qtyPlaceholder': 'Qty - e.g. 10 bags',
  'financing.apply.itemAria': 'Item {n}',
  'financing.apply.qtyAria': 'Quantity {n}',
  'financing.apply.removeItemAria': 'Remove item {n}',

  'financing.apply.disbursementQuestion': 'How should the bank disburse, if approved? *',
  'financing.apply.supplierPayment.title': 'Supplier payment (recommended)',
  'financing.apply.supplierPayment.body': 'The bank pays approved input suppliers directly - you receive the inputs, not cash.',
  'financing.apply.supplierPayment.short': 'Supplier payment',
  'financing.apply.cash.title': 'Cash disbursement',
  'financing.apply.cash.body': 'The bank disburses to you directly under its own terms.',
  'financing.apply.cash.short': 'Cash',
  'financing.apply.disbursementNote': 'All disbursements are made by the partner bank. Loamy never holds or transfers funds.',

  'financing.apply.productLine': 'Input Financing \u00b7 Murabaha (non-interest)',
  'financing.apply.noneListed': 'None listed',
  'financing.apply.submitNote': 'By submitting, your application and farm profile are shared with the partner bank, which makes and communicates the decision. Loamy does not approve, decline, or disburse.',
  'financing.apply.submit': 'Submit application',
  'financing.apply.draftNote': 'Progress is saved as a draft each time you press Next - you can leave and continue later.',

  /* --- the bank officer's application detail -------------------------------
   *
   * This surface is read by partner-bank staff, not by members, and almost
   * everything on it is EVIDENCE: a transaction ref, a batch ref, a commodity
   * name, a risk tier, a GPS pair, an officer's own pricing note. None of
   * that is translated -- it is the record the institution is deciding on,
   * and a translated record is a different record.
   *
   * What IS translated is the furniture around the evidence: the headings,
   * the column names and the few sentences Loamy writes itself.
   */
  'financing.bank.backToPipeline': 'Pipeline',
  'financing.bank.applicant': 'Applicant',
  'financing.bank.verifiedAria': 'Verified',
  'financing.bank.sandbox': 'sandbox',
  'financing.bank.memberSince': 'member since',
  'financing.bank.noPhone': 'no phone',
  'financing.bank.generateReport': 'Generate report',
  'financing.bank.loadingApplication': 'Loading application',

  'financing.bank.purchaseFinanced': 'The purchase being financed',
  'financing.bank.transaction': 'Transaction',
  'financing.bank.commodity': 'Commodity',
  'financing.bank.quantity': 'Quantity',
  'financing.bank.purchaseTotal': 'Purchase total',
  'financing.bank.seller': 'Seller',
  'financing.bank.agreement': 'Agreement',
  'financing.bank.payment': 'Payment',
  'financing.bank.stock': 'Stock',
  'financing.bank.sellerDeclaration': 'Seller declaration',

  'financing.bank.requestedFacility': 'Requested facility',
  'financing.bank.amount': 'Amount',
  'financing.bank.product': 'Product',
  'financing.bank.productLine': 'Input financing \u00b7 Murabaha',
  'financing.bank.disbursement': 'Disbursement',
  'financing.bank.supplierPaymentLong': 'Supplier payment (bank pays suppliers directly)',
  'financing.bank.cash': 'Cash',
  'financing.bank.submitted': 'Submitted',
  'financing.bank.intendedItem': 'Intended item',
  'financing.bank.qty': 'Qty',

  'financing.bank.yieldHistory': 'Yield history - actual kg per season',
  'financing.bank.farmsAndProduction': 'Farms and production history',
  'financing.bank.noFarms': 'No farms registered.',
  'financing.bank.verifiedOn': 'Verified {date}',
  'financing.bank.crops': 'Crops: {crops}',
  'financing.bank.gpsConfirmed': 'GPS-confirmed during field verification',
  'financing.bank.season': 'Season',
  'financing.bank.crop': 'Crop',
  'financing.bank.expectedKg': 'Expected kg',
  'financing.bank.actualKg': 'Actual kg',

  'financing.bank.marketplaceActivity': 'Marketplace activity',
  'financing.bank.activeListings': 'Active listings',
  'financing.bank.concludedConnections': 'Concluded connections',
  'financing.bank.onboardedByPartner': 'Onboarded by field partner',
  'financing.bank.priorApplications': 'Prior applications',
  'financing.bank.noneOnRecord': 'None on record.',

  'financing.bank.riskClassification': 'Risk classification',
  'financing.bank.score': 'score {score}',

  'financing.bank.recordedDecision': 'Recorded decision',
  'financing.bank.approved': 'Approved',
  'financing.bank.requested': 'Requested',
  'financing.bank.disbursed': 'Disbursed',
  'financing.bank.tenor': 'Tenor',
  'financing.bank.tenorDays': '{days} days',
  'financing.bank.pricing': 'Pricing',
  'financing.bank.yourReference': 'Your reference',
  'financing.bank.decided': 'Decided',

  'financing.bank.decisionTrail': 'Decision trail',
  'financing.bank.actor.bank': 'Your institution',
  'financing.bank.actor.applicant': 'The applicant',
  'financing.bank.actor.platform': 'Loamy',
  'financing.bank.actor.system': 'System',

  'financing.bank.generatedReports': 'Generated reports',
  'financing.bank.noReports': 'None yet. Reports are immutable snapshots.',

  // --- financing against a single purchase ---------------------------------
  // A different surface from the seasonal application: it hangs off one
  // transaction, and the bank is chosen here rather than assumed. The bank's
  // NAME is data and is interpolated; everything around it is wording.
  'financing.purchase.notAvailable': 'That purchase is not available.',
  'financing.purchase.backToPurchase': 'Back to the purchase',
  'financing.purchase.subtitle': 'For this purchase only. Loamy is not the lender and does not decide the outcome.',
  'financing.purchase.whatYouAreFinancing': 'What you are financing',
  'financing.purchase.reference': 'Reference',
  'financing.purchase.commodity': 'Commodity',
  'financing.purchase.quantity': 'Quantity',
  'financing.purchase.purchaseTotal': 'Purchase total',

  'financing.purchase.howMuch': 'How much of it do you need financed?',
  'financing.purchase.fullAmount': 'Full amount',
  'financing.purchase.cannotExceed': 'Financing cannot exceed the purchase ({total}).',
  'financing.purchase.amountHint': 'Defaults to the purchase total. You can ask for less, never more.',

  'financing.purchase.chooseInstitution': 'Choose an institution',
  'financing.purchase.institutionNote': 'Each institution sets its own policy, terms and decision. Loamy passes on your application and the agricultural record behind it.',
  'financing.purchase.noInstitutions': 'No institution is accepting applications through Loamy yet.',
  'financing.purchase.acceptsApplications': 'Accepts applications',

  'financing.purchase.haveAccount': 'Do you have a {bank} account?',
  'financing.purchase.createOne': 'I\u2019d like to create one',
  'financing.purchase.accountRefLabel': 'Your reference with the bank (optional)',
  'financing.purchase.accountRefPlaceholder': 'The reference the bank gave you',
  // BVN is a named national identifier and stays as BVN in every language.
  'financing.purchase.accountRefNote': 'Loamy stores an opaque reference and the last four digits - never a full account number, and never a BVN. The bank holds your identity record.',
  'financing.purchase.openAccountWith': 'Open an account with {bank}',
  'financing.purchase.openAccountNote': 'This opens the bank\u2019s own process. They collect and hold the identity documents; Loamy collects nothing further.',
  'financing.purchase.noAccountOpening': 'This institution does not offer account opening through Loamy yet. Contact them directly, then come back and apply.',

  'financing.purchase.yourLoamyRecord': 'Your Loamy record',
  'financing.purchase.submitTo': 'Submit to {bank}',
  'financing.purchase.theInstitution': 'the institution',
  'financing.purchase.submitNote': 'Submitting does not approve anything.',

  // --- review step ---------------------------------------------------------
  'financing.review.product': 'Product',
  'financing.review.farm': 'Farm',
  'financing.review.amount': 'Amount',
  'financing.review.purpose': 'Purpose',
  'financing.review.items': 'Items',
  'financing.review.disbursement': 'Disbursement',

  // --- table headers -------------------------------------------------------
  'financing.col.opened': 'Opened',
  'financing.col.principal': 'Principal',
  'financing.col.sector': 'Sector',
  'financing.col.status': 'Status',
  'financing.col.product': 'Product',
  'financing.col.amount': 'Amount',
  'financing.col.submitted': 'Submitted',
  'financing.col.actions': 'Actions',
} as const
