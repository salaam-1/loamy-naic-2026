/**
 * Verification and traceability.
 *
 * WHAT MUST SURVIVE TRANSLATION
 *   The distinction between DECLARED (the member said so) and VERIFIED (a
 *   Growth Partner checked it on the ground) is the whole basis of trust on
 *   this platform. A translation that blurs the two is worse than English.
 *
 *   Trace references (BATCH-, TXN-, FIN-) are identifiers, never translated.
 *   Agent names are withheld by design and are not a translation concern.
 */
export const verification = {
  'verification.title': 'Verification',
  'verification.verified': 'Verified',
  'verification.unverified': 'Not verified',
  'verification.pending': 'Verification pending',
  'verification.rejected': 'Verification rejected',
  'verification.requestVerification': 'Request verification',
  'verification.requested': 'Verification has been requested.',

  'verification.declared': 'Declared',
  'verification.declaredMeaning': 'Stated by the member, not yet checked on the ground.',
  'verification.verifiedMeaning': 'Checked on the ground by a Growth Partner.',
  'verification.whyItMatters': 'Verification confirms your identity and, for sellers, that your farm and produce are real. Verified members earn a badge buyers and banks trust.',
  'verification.neverSeesId': 'Capture is provider-hosted, so your BVN and NIN never reach Loamy.',

  'verification.task': 'Verification task',
  'verification.tasks': 'Verification tasks',
  'verification.assignTask': 'Assign',
  'verification.claimTask': 'Claim this task',
  'verification.submitEvidence': 'Submit evidence',
  'verification.evidence': 'Evidence',
  'verification.fieldVisit': 'Field visit',
  'verification.awaitingVisit': 'Awaiting a field visit',
  'verification.onlyAssignedAgent': 'Only the agent assigned to this case can submit evidence.',

  /* --- field operations vocabulary -----------------------------------------
   *
   * Mirrors src/lib/fieldops.ts WORD FOR WORD, and
   * tests/unit/verification-i18n.test.ts holds the two equal. Same reasoning
   * as financing: the lib map decides the colour and the routing, the pack
   * decides the words, and English must not fork between them.
   *
   * THE AGENT IS ANONYMOUS UNTIL A TASK IS CLAIMED, AND THAT IS NOT COPY.
   *   The withholding is done by the server. Nothing here names an agent or
   *   a subject, and `verification.fieldOps.locationOnAssignment` is what a
   *   member sees INSTEAD of a location, not a label for one.
   */
  'verification.taskState.pending': 'Not published',
  'verification.taskState.available': 'Open to claim',
  'verification.taskState.assigned': 'Assigned to you',
  'verification.taskState.accepted': 'Accepted',
  'verification.taskState.in_progress': 'In progress',
  'verification.taskState.submitted': 'With Loamy',
  'verification.taskState.under_review': 'Under review',
  'verification.taskState.approved': 'Approved',
  'verification.taskState.rejected': 'Rejected',
  'verification.taskState.needs_more_information': 'More needed',
  'verification.taskState.resubmit_requested': 'More needed',
  'verification.taskState.expired': 'Expired',
  'verification.taskState.cancelled': 'Cancelled',

  /* A SECOND task-status vocabulary, and deliberately a separate namespace.
   *
   * `TASK_STATUS_META` in src/lib/partner.ts covers the same database
   * statuses as `TASK_STATE` in fieldops.ts and gives them DIFFERENT words:
   * `pending` is "Not published" to a field agent looking at the pool and
   * "Awaiting partner" to the admin queue watching the same row. Both are
   * right for their reader.
   *
   * Collapsing them into one key would silently change one of the two
   * surfaces, so they are translated separately. That the platform has two
   * vocabularies for one state machine is worth deciding about on purpose --
   * it is not something this pass should settle by accident.
   */
  'verification.partnerTaskState.pending': 'Awaiting partner',
  'verification.partnerTaskState.assigned': 'Assigned',
  'verification.partnerTaskState.accepted': 'Accepted by partner',
  'verification.partnerTaskState.in_progress': 'Visit in progress',
  'verification.partnerTaskState.submitted': 'Awaiting admin review',
  'verification.partnerTaskState.approved': 'Approved',
  'verification.partnerTaskState.rejected': 'Rejected',
  'verification.partnerTaskState.resubmit_requested': 'Resubmission requested',
  'verification.partnerTaskState.needs_more_information': 'More evidence requested',

  'verification.partner.farmVerification': 'Farm verification',
  'verification.partner.requestedOn': 'requested {date}',
  'verification.partner.open': 'Open',

  'verification.taskType.identity_verification': 'Identity',
  'verification.taskType.farmer_verification': 'Farmer',
  'verification.taskType.farm_verification': 'Farm',
  'verification.taskType.farm_geospatial': 'Farm mapping',
  'verification.taskType.business_verification': 'Business',
  'verification.taskType.buyer_verification': 'Buyer',
  'verification.taskType.seller_verification': 'Seller',
  'verification.taskType.commodity_verification': 'Commodity',
  'verification.taskType.batch_verification': 'Batch',
  'verification.taskType.quantity_verification': 'Quantity',
  'verification.taskType.quality_verification': 'Quality',
  'verification.taskType.transaction_verification': 'Transaction',
  'verification.taskType.loading_verification': 'Loading',
  'verification.taskType.warehouse_verification': 'Warehouse',
  'verification.taskType.warehouse_arrival_verification': 'Warehouse arrival',
  'verification.taskType.logistics_verification': 'Logistics',
  'verification.taskType.delivery_verification': 'Delivery',
  'verification.taskType.document_verification': 'Document',
  'verification.taskType.market_price_collection': 'Market prices',
  'verification.taskType.field_support': 'Field support',

  /* Flags. Every one of these says a HUMAN WILL LOOK, and none of them says
   * anyone did anything wrong. A translation that turns "Device clock was
   * ahead" into an accusation of tampering breaks the agent's trust in the
   * system, which is the precise failure the English was written to avoid. */
  'verification.flag.no_gps': 'No GPS fix was recorded',
  'verification.flag.low_gps_accuracy': 'GPS accuracy was poor at capture',
  'verification.flag.gps_far_from_subject': 'Captured away from the registered location',
  'verification.flag.no_reference_location': 'No registered location to compare against',
  'verification.flag.future_timestamp': 'Device clock was ahead',
  'verification.flag.captured_before_case_existed': 'Capture pre-dates the request',
  'verification.flag.duplicate_evidence': 'The same file appears on another case',
  'verification.flag.repeated_identical_coordinates': 'Same coordinates used for a different subject',
  'verification.flag.impossible_travel': 'Distance between captures is faster than road travel',
  'verification.flag.rapid_completion': 'Case completed unusually quickly',
  'verification.flag.quantity_mismatch': 'Quantity differs from the record',
  'verification.flag.no_loading_photo': 'No loading photograph',
  'verification.flag.no_waybill': 'No waybill reference',
  'verification.flag.no_quantity_confirmed': 'Quantity not confirmed',
  'verification.flagDisclaimer': 'Flags mean a reviewer will look at this case. They are not an accusation, and they do not reject anything on their own.',

  'verification.eligibility.not_a_growth_partner': 'This account is not set up for field work.',
  'verification.eligibility.account_inactive': 'This account is not active.',
  'verification.eligibility.suspended': 'Your account is suspended. Contact Loamy.',
  'verification.eligibility.marked_unavailable': 'You have marked yourself unavailable.',
  'verification.eligibility.training_incomplete': 'This task type needs training you have not completed.',
  'verification.eligibility.not_cleared_for_this_task_type': 'You are not cleared for this task type yet.',
  'verification.eligibility.workload_at_capacity': 'You already hold the maximum number of open tasks.',
  'verification.eligibility.outside_service_area': 'This task is outside your service area.',

  /* Commission states. These describe MONEY OWED TO THE AGENT and each one
   * is precise about whether it has moved: "Agreed as owed to you. Not yet
   * released for payment." is not the same promise as "Paid", and a
   * translation that collapses them would be a promise Loamy cannot keep. */
  'verification.commission.estimated': 'Estimated',
  'verification.commission.estimatedHelp': 'What this task is expected to pay if the work is approved.',
  'verification.commission.pending': 'Pending',
  'verification.commission.pendingHelp': 'Your work was approved. Loamy is reviewing the commission.',
  'verification.commission.approved': 'Approved',
  'verification.commission.approvedHelp': 'Agreed as owed to you. Not yet released for payment.',
  'verification.commission.payable': 'Payable',
  'verification.commission.payableHelp': 'Cleared for payment. The money has not moved yet.',
  'verification.commission.paid': 'Paid',
  'verification.commission.paidHelp': 'Settled, with a payment reference on record.',
  'verification.commission.reversed': 'Reversed',
  'verification.commission.reversedHelp': 'Withdrawn after review. The reason is recorded.',
  'verification.commission.disputed': 'Disputed',
  'verification.commission.disputedHelp': 'Under dispute. Nothing moves until it is resolved.',
  'verification.commission.accruedHelp': 'Recorded before the current commission workflow.',
  'verification.commission.paidExternallyHelp': 'Settled outside Loamy, before the current workflow.',

  // --- the field-ops console ------------------------------------------------
  'verification.fieldOps.alreadyTaken': 'Another agent took this task first.',
  'verification.fieldOps.cannotTake': 'You cannot take this task.',
  'verification.fieldOps.claimed': 'Task claimed. Accept it to begin.',
  'verification.fieldOps.suspendedBanner': 'Your account is suspended',
  'verification.fieldOps.suspendedBody': 'You cannot take new work. Your completed work, evidence and commission history are unaffected.',
  'verification.fieldOps.today': 'Today',
  'verification.fieldOps.inProgress': 'In progress',
  'verification.fieldOps.withLoamy': 'With Loamy',
  'verification.fieldOps.needsYourAction': 'Needs your action',
  'verification.fieldOps.openNearby': 'Open nearby',
  'verification.fieldOps.availability': 'Availability',
  'verification.fieldOps.training': 'Training:',
  'verification.fieldOps.available': 'Available',
  'verification.fieldOps.busy': 'Busy',
  'verification.fieldOps.unavailable': 'Unavailable',
  'verification.fieldOps.openInYourArea': 'Open in your area',
  // Shown INSTEAD of a location, because the subject's whereabouts are not
  // disclosed until the task is claimed.
  'verification.fieldOps.detailsOnClaim': 'Exact locations and subject details appear once a task is yours.',
  'verification.fieldOps.locationOnAssignment': 'Location on assignment',
  'verification.fieldOps.noOpenTasks': 'No open tasks in your service area right now.',
  'verification.fieldOps.highPriority': 'High priority',
  'verification.fieldOps.claim': 'Claim',
  'verification.fieldOps.myWork': 'My work',
  'verification.fieldOps.nothingAssigned': 'Nothing assigned to you yet.',
  'verification.fieldOps.evidenceCount': '{count} item of evidence',
  'verification.fieldOps.evidenceCount_plural': '{count} items of evidence',
  'verification.fieldOps.reviewer': 'Reviewer: {note}',
  'verification.fieldOps.commissionLine': 'Commission {amount} · {status}',
  'verification.fieldOps.earnings': 'Earnings',
  'verification.fieldOps.owedToYou': 'Owed to you',
  'verification.fieldOps.paid': 'Paid',
  'verification.fieldOps.performance': 'Performance',
  'verification.fieldOps.approvedWork': 'Approved work',
  'verification.fieldOps.completionRate': 'Completion rate',
  'verification.fieldOps.shownOnceDecided': 'Shown once enough cases are decided.',
  'verification.fieldOps.averageTurnaround': 'Average turnaround',
  'verification.fieldOps.flagsRaised': 'Flags raised on your captures',
  'verification.fieldOps.serviceArea': 'Service area',
  'verification.fieldOps.allLgas': 'All LGAs',
  'verification.fieldOps.loadingTasks': 'Loading tasks',
  'verification.fieldOps.noUnassigned': 'No unassigned tasks in your territory right now. New requests notify you immediately.',
  'verification.fieldOps.noTasksAssigned': 'No tasks assigned to you yet',

  'trace.title': 'Trace',
  'trace.reference': 'Reference',
  'trace.searchPlaceholder': 'Enter a batch, transaction or financing reference',
  'trace.notFound': 'We could not find anything with that reference.',
  'trace.origin': 'Origin',
  'trace.chain': 'Chain of custody',
  'trace.recordedOn': 'Recorded {date}',
  'trace.noAccess': 'You do not have access to this record.',
  // --- Wave A.2: field task detail -----------------------------------------
  /* Task detail: the screen an agent uses while standing on the land.
   *
   * A FLAG IS NOT A FAILURE, AND THE COPY HAS TO KEEP SAYING SO.
   *   The GPS explainer ends "a mismatch is flagged for review, it does
   *   not fail you". That clause is the difference between a system an
   *   agent trusts and one they work around, and it must survive
   *   translation whole. Same for the discard notice: evidence is
   *   superseded, never erased, which is an audit guarantee rather than a
   *   nicety. */
  'verification.task.loadingTask': 'Loading task',
  'verification.task.allTasks': 'All tasks',
  'verification.task.notYours': 'This task does not exist or is not assigned to you.',
  'verification.task.fieldVerification': 'Field verification',
  'verification.task.farmerToConfirm': 'Farmer to confirm in person:',
  'verification.task.takeThisJob': 'Take this job on?',
  'verification.task.reservedExplainer': 'You have reserved this task. Accepting commits you to the field visit. Declining returns it to the pool for another partner - no penalty, and better than holding a job you cannot reach.',
  'verification.task.acceptThisTask': 'Accept this task',
  'verification.task.couldNotAccept': 'That task could not be accepted.',
  'verification.task.couldNotDecline': 'That task could not be declined.',
  'verification.task.gpsHeading': '1 · GPS capture (standing at the location)',
  'verification.task.gpsExplainer': 'Capture your device position at the farm. Distance from the registered pin, accuracy and the device clock are all checked by Loamy - a mismatch is flagged for review, it does not fail you.',
  'verification.task.captureGpsNow': 'Capture GPS now',
  'verification.task.captureAnotherFix': 'Capture another fix',
  'verification.task.gpsFix': 'GPS fix',
  'verification.task.locationDenied': 'Location permission denied. Allow location to verify where you are standing.',
  'verification.task.noFixInTime': 'Could not get a fix in time. Try again in the open.',
  'verification.task.couldNotGetLocation': 'Could not get your location.',
  'verification.task.photosHeading': '2 · Photographs ({sent} sent, minimum {min})',
  'verification.task.photograph': 'Photograph',
  'verification.task.takeAddPhotographs': 'Take / add photographs',
  'verification.task.onThisDevice': 'On this device',
  'verification.task.receivedByLoamy': 'Received by Loamy',
  'verification.task.retry': 'Retry',
  'verification.task.discardCapture': 'Discard this capture',
  'verification.task.discardExplainer': 'Discarding removes a capture that has not reached Loamy. Anything already sent cannot be deleted - evidence is superseded, never erased.',
  'verification.task.privateStore': 'Photographs go to a private, access-controlled store. The farmer never sees raw evidence. You can keep capturing with no signal - everything uploads when you are back in coverage.',
  'verification.task.capturedAt': 'captured',
  'verification.task.checklistHeading': '3 · Field checklist',
  'verification.task.noChecklist': 'No checklist is defined for this task type yet. Capture evidence and add a field note; the review team will follow up.',
  'verification.task.overallFieldNote': 'Overall field note',
  'verification.task.notePlaceholder': 'Anything the review team should know',
  'verification.task.saveProgress': 'Save progress',
  'verification.task.submitForReview': 'Submit for review',
  'verification.task.progressSaved': 'Progress saved.',
  'verification.task.submittedForReview': 'Submitted for review.',
  'verification.task.couldNotSave': 'Could not save.',
  'verification.task.awaitingReview': 'Submitted - awaiting review. You will be notified of the decision.',
  // --- Wave A.2: field operations ------------------------------------------
  'verification.gp.farmersOnboarded': 'Farmers Onboarded',
  'verification.gp.verifications': 'Verifications',
  'verification.gp.accruedEarnings': 'Accrued Earnings',
  'verification.gp.trackedPaidOffPlatform': 'tracked, paid off-platform',
  'verification.gp.territory': 'Territory',
  'verification.gp.territoryPerLga': 'Territory - farmers per LGA',
  'verification.gp.onboardingFunnel': 'Onboarding funnel',
  'verification.gp.earningsChart': 'Earnings accrued (weekly, ₦)',
  'verification.gp.accruedNaira': 'Accrued ₦',
  'verification.gp.farmers': 'Farmers',
  'verification.gp.registered': 'Registered',
  'verification.gp.profileCompleted': 'Profile completed',
  'verification.gp.active30d': 'Active (30d)',
  'verification.gp.onboarding': 'Onboarding',
  'verification.gp.onboardAFarmer': 'Onboard a farmer',
  'verification.gp.myFarmers': 'My farmers',
  'verification.gp.noActivityYet': 'No activity yet. Onboard your first farmer to get started.',
  'verification.gp.notAssignedYet': 'Not assigned yet',
  'verification.gp.howEarningsWork': 'How earnings work',
  'verification.onboard.heading': 'Onboard a farmer (assisted signup)',
  'verification.onboard.fullName': "Farmer's full name *",
  'verification.onboard.namePlaceholder': 'e.g. Musa Ibrahim',
  'verification.onboard.email': 'Email *',
  'verification.onboard.emailPlaceholder': 'farmer@example.com',
  'verification.onboard.phone': 'Phone *',
  'verification.onboard.startingPassword': 'Starting password * (farmer changes it on first login)',
  'verification.onboard.passwordTooShort': 'Starting password must be at least 8 characters.',
  'verification.onboard.createAccount': 'Create farmer account',
  'verification.onboard.accountCreated': 'Farmer account created',
  'verification.onboard.confirmationSentTo': 'A confirmation email was sent to',
  'verification.onboard.onboardAnother': 'Onboard another farmer',
  'verification.onboard.yourReferralLink': 'Your referral link',
  'verification.onboard.referralQr': 'Referral QR code',
  'verification.onboard.copyLink': 'Copy link',
  'verification.farmers.loading': 'Loading farmers',
  'verification.farmers.noneYet': 'No farmers onboarded yet',
  'verification.farmers.verifiedBadge': 'Verified - this farmer carries the marketplace badge.',
  'verification.farmers.notVerified': 'Not yet verified - verification happens through the field workflow.',
  'verification.inspection.noneAvailable': 'No inspections available right now',
  'verification.inspection.noneAvailableHint': 'When a processor requests an inspection in a state/LGA you cover, it appears here to claim.',
  'verification.inspection.couldNotLoad': 'Could not load inspections.',
  'verification.inspection.couldNotClaim': 'Could not claim this inspection.',
  'verification.inspection.couldNotSubmit': 'Could not submit the report.',
  'verification.inspection.photoUploadFailed': 'Photo upload failed.',
  'verification.inspection.fileReport': 'File report',
  'verification.inspection.recommendation': 'Recommendation *',
  'verification.inspection.pass': 'Pass',
  'verification.inspection.conditional': 'Conditional',
  'verification.inspection.fail': 'Fail',
  'verification.inspection.moisture': 'Moisture reading (%)',
  'verification.inspection.qualityNotes': 'Quality notes',
  'verification.inspection.notesPlaceholder': 'Grading, foreign matter, packaging condition…',
  'verification.inspection.addPhoto': 'Add photo',
  'verification.inspection.captureGps': 'Capture GPS',
  'verification.inspection.gpsCaptured': 'GPS captured',
  'verification.inspection.locating': 'Locating…',
  'verification.inspection.submitReport': 'Submit report',
  'verification.inspection.submitting': 'Submitting…',
  'verification.earnings.loading': 'Loading earnings',
  'verification.earnings.accrued': 'Accrued',
  'verification.earnings.paidExternally': 'Paid (externally)',
  'verification.earnings.settledOutside': 'settled outside Loamy',
  'verification.earnings.history': 'Earning history',
  'verification.earnings.farmerOnboarding': 'Farmer onboarding',
  'verification.earnings.paidExternallyShort': 'Paid externally',
  'verification.earnings.owedVsPaid': 'Owed is what your approved work has earned. Paid is what has actually been settled.',
  // --- Wave A.2: field ops, remaining labels -------------------------------
  'verification.gp.attributedToYou': 'attributed to you',
  'verification.gp.approvedByReview': 'approved by review',
  'verification.gp.activeAssignment': 'active assignment',
  'verification.gp.recentActivity': 'Recent activity',
  'verification.gp.quickActions': 'Quick actions',
  'verification.gp.verified': 'Verified',
  'verification.onboard.copied': 'Copied',
  'verification.onboard.pwPlaceholder': 'At least 8 characters',
  'verification.onboard.phonePlaceholder': 'e.g. 0803 123 4567',
  'verification.onboard.selectState': 'Select state…',
  'verification.onboard.state': 'State *',
  'verification.earnings.awaitingPayout': 'awaiting off-platform payout',
  'verification.earnings.farmVerification': 'Farm verification',
  // --- Wave A.2: earnings custody ------------------------------------------
  'verification.earnings.noBalance': 'Loamy holds no balance for you.',
  // --- Wave A.2: field ops prose -------------------------------------------
  'verification.tasks.noneAssignedHint': 'Claim a task from your territory pool above, or wait for an admin assignment. Evidence capture happens on this device at the farm.',
  'verification.farmers.noneYetHintFull': 'Farmers you sign up in the field, or who join through your referral link, appear here with their verification status.',
  'verification.earnings.nothingYetFull': 'Nothing accrued yet. Onboarding farmers and completing verifications earns commission at the rates set by the Loamy team.',
  'verification.gp.commissionExplainer': 'You earn a commission for each farmer you onboard and each verification you complete (rates set by the Loamy team). Earnings are tracked here.',
  'verification.onboard.explainerFull': "Create the farmer's account on your device, in the field. They log in with the email and starting password you set here.",
  'verification.onboard.attributionFull': 'Farmers who sign up through this link or QR code are automatically attributed to you and accrue your onboarding commission.',
  'verification.payoutCopy': 'Payouts are processed outside the platform during the pilot period.',
} as const
