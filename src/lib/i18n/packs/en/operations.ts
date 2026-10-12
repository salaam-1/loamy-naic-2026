/**
 * Logistics, warehousing, bookings and inspections.
 *
 * Grouped as one namespace because they are one operational flow: goods are
 * loaded, moved, stored, inspected and delivered against a single transaction.
 * Splitting them would scatter a vocabulary that has to stay consistent.
 *
 * State names, LGAs, carrier names and facility names are DATA.
 */
export const operations = {
  'logistics.title': 'Logistics',
  'logistics.transportJob': 'Transport job',
  'logistics.transportJobs': 'Transport Jobs',
  'logistics.openJobs': 'Open jobs',
  'logistics.myFleet': 'My Fleet',
  'logistics.pickup': 'Pickup',
  'logistics.dropoff': 'Dropoff',
  'logistics.requestedDate': 'Requested date',
  'logistics.offer': 'Offer',
  'logistics.submitOffer': 'Submit an offer',
  'logistics.offerSubmitted': 'Your offer has been sent.',
  'logistics.award': 'Award',
  'logistics.awarded': 'Awarded',
  'logistics.declined': 'Declined',

  'logistics.status.broadcast': 'Open for offers',
  'logistics.status.assigned': 'Assigned',
  'logistics.status.loaded': 'Loaded',
  'logistics.status.departed': 'Departed',
  'logistics.status.in_transit': 'In transit',
  'logistics.status.arrived': 'Arrived',
  'logistics.status.delivered': 'Delivered',

  'logistics.confirmLoading': 'Confirm loading',
  'logistics.loadingEvidence': 'Loading evidence',
  'logistics.confirmDelivery': 'Confirm delivery',
  'logistics.empty': 'No transport jobs yet',

  /* Fulfilment state, mirroring FULFILMENT_LABEL in src/lib/fulfilment.ts.
   *
   * `failed` reads "Stopped", not "Failed", and that is deliberate: the
   * member whose goods are sitting somewhere has not failed at anything, and
   * the word they read should describe the consignment rather than blame
   * them. A translation that reaches for the local equivalent of "failure"
   * loses that. */
  'logistics.fulfilment.not_started': 'Not started',
  'logistics.fulfilment.loading_requested': 'Loading requested',
  'logistics.fulfilment.loading_scheduled': 'Loading scheduled',
  'logistics.fulfilment.loading': 'Loading',
  'logistics.fulfilment.loaded': 'Loaded',
  'logistics.fulfilment.in_transit': 'In transit',
  'logistics.fulfilment.at_warehouse': 'At warehouse',
  'logistics.fulfilment.arrived': 'Arrived',
  'logistics.fulfilment.delivered': 'Delivered',
  'logistics.fulfilment.received': 'Received',
  'logistics.fulfilment.failed': 'Stopped',
  'logistics.fulfilment.cancelled': 'Cancelled',

  /* Journey events, mirroring LOGISTICS_EVENT_LABEL. These are what the
   * carrier RECORDED, not what the interface concluded. */
  'logistics.event.loading': 'Loading',
  'logistics.event.loaded': 'Loaded',
  'logistics.event.departed': 'Departed',
  'logistics.event.position': 'Position update',
  'logistics.event.arrived': 'Arrived',
  'logistics.event.delivered': 'Delivered',
  'logistics.event.failed': 'Failed',
  'logistics.event.cancelled': 'Cancelled',
  'logistics.event.disputed': 'Disputed',
  'logistics.event.note': 'Note',

  /* Loading evidence gaps, mirroring LOADING_FLAG_LABEL. The lib comment on
   * that map reads "Never softened", and that instruction is part of the
   * string: "No quantity was confirmed at loading." must not become
   * "quantity pending" in any language. Each one states a FACT about the
   * record and accuses nobody of anything. */
  'logistics.loadingFlag.no_quantity_confirmed': 'No quantity was confirmed at loading.',
  'logistics.loadingFlag.quantity_mismatch': 'The quantity loaded does not match the purchase.',
  'logistics.loadingFlag.no_loading_photo': 'No photograph was taken at loading.',
  'logistics.loadingFlag.no_waybill': 'No waybill reference was recorded.',
  'logistics.loadingFlag.no_gps': 'No location was captured at loading.',

  /* Whose move it is, mirroring whoseMove() in src/lib/fulfilment.ts.
   * The RULE stays in the lib and is unit-tested there; these are only its
   * words. The actor and the action are separate keys because the panel
   * renders the actor in bold and the action beside it. */
  'logistics.move.you': 'You',
  'logistics.move.theSeller': 'The seller',
  'logistics.move.theBuyer': 'The buyer',
  'logistics.move.theCarrier': 'The carrier',
  'logistics.move.carriers': 'Carriers',
  'logistics.move.delivered': 'Delivered',
  'logistics.move.scheduleLoading': 'Schedule loading when the goods are ready.',
  'logistics.move.sellerYetToSchedule': 'is yet to schedule loading.',
  'logistics.move.arrangeTransport': 'Arrange transport for this purchase.',
  'logistics.move.buyerYetToArrange': 'is yet to arrange transport.',
  'logistics.move.chooseOffers': 'Choose one of {count} carrier offers.',
  'logistics.move.buyerChoosing': 'is choosing a carrier.',
  'logistics.move.carriersInvited': 'are being invited to quote.',
  'logistics.move.dueToCollect': 'is due to collect the goods.',
  'logistics.move.movingGoods': 'is moving the goods.',
  'logistics.move.hasBeenDelivered': 'This purchase has been delivered.',

  // --- the fulfilment panel -------------------------------------------------
  'logistics.panel.loading': 'Loading fulfilment\u2026',
  'logistics.panel.fulfilment': 'Fulfilment',
  'logistics.panel.warehouseReceipts': 'Warehouse receipts',
  'logistics.panel.settlement': 'Settlement',
  // Both branches say the institution pays and Loamy does not hold. Neither
  // may become "we paid the seller" or "we are holding the money".
  'logistics.panel.settledToSeller': 'The institution settled {amount} to the seller.',
  'logistics.panel.nothingSettled': 'Nothing has been settled yet. The institution pays the seller directly; Loamy holds no funds.',
  'logistics.panel.sandboxFinancing': 'This financing is a sandbox simulation. No money moves.',

  // --- loading --------------------------------------------------------------
  'logistics.loading.title': 'Loading',
  'logistics.loading.waybillRef': 'Waybill reference',
  'logistics.loading.vehicleReg': 'Vehicle registration',
  'logistics.loading.note': 'Note',
  'logistics.loading.record': 'Record',
  'logistics.loading.buyerSeesThis': 'Optional. The buyer sees this.',

  // --- transport ------------------------------------------------------------
  'logistics.transport.title': 'Transport',
  'logistics.transport.howIsThisMoving': 'How is this moving?',
  'logistics.transport.findCarrier': 'Find a carrier through Loamy',
  'logistics.transport.ownCarrier': 'I have my own carrier',
  'logistics.transport.pickUpFrom': 'Pick up from',
  'logistics.transport.deliverTo': 'Deliver to',
  'logistics.transport.carrierName': 'Carrier name',
  'logistics.transport.preferredDate': 'Preferred date',
  'logistics.transport.arrange': 'Arrange transport',
  'logistics.transport.bookedWith': 'Booked with',
  'logistics.transport.bookedWithProvider': 'Booked with {provider}{price}.',
  'logistics.transport.ownCarrierNamed': 'Your own carrier: {provider}.',
  'logistics.transport.ownCarrierUnnamed': 'Your own carrier.',
  'logistics.transport.atPrice': ' at {price}',
  'logistics.transport.quoted': '{count} carrier has quoted.',
  'logistics.transport.quoted_plural': '{count} carriers have quoted.',
  'logistics.transport.outToCarriers': 'Out to carriers. No offers yet.',
  'logistics.transport.optionalPlaceholder': 'Optional',
  'logistics.transport.bookCarrier': 'Book this carrier',

  // --- delivery -------------------------------------------------------------
  'logistics.delivery.title': 'Delivery',
  'logistics.delivery.confirmReceipt': 'Confirm receipt',

  'warehouse.title': 'Warehouse',
  'warehouse.myWarehouses': 'My Warehouses',
  'warehouse.reservations': 'Reservations',
  'warehouse.storageRequest': 'Storage request',
  'warehouse.storageRequests': 'Storage Requests',
  'warehouse.requestSpace': 'Request space',
  'warehouse.capacity': 'Capacity',
  'warehouse.received': 'Received into storage',
  'warehouse.releaseStock': 'Release stock',
  'warehouse.notBookedYet': 'Requested, not booked. A facility has to accept it.',

  /* --- asking a warehouse for space ----------------------------------------
   *
   * STORAGE IS OPT-IN AND THE COPY IS WHAT MAKES THAT TRUE.
   *   "Most purchases go straight to the buyer. Ask a warehouse for space
   *   only if you need it." is not a hint, it is the reason nobody books
   *   storage they did not want. A translation that reads as a prompt to
   *   book -- or that drops "only if you need it" -- changes what the
   *   product does to the member who reads it.
   *
   *   Likewise "Ask for space" and "Send request": the member is REQUESTING,
   *   and a facility has to accept. Neither may become "Book".
   */
  'warehouse.storage.title': 'Storage',
  'warehouse.storage.optional': 'Optional',
  'warehouse.storage.mostGoStraight': 'Most purchases go straight to the buyer. Ask a warehouse for space only if you need it.',
  'warehouse.storage.findStorage': 'Find storage',
  'warehouse.storage.looking': 'Looking for facilities\u2026',
  'warehouse.storage.askForSpace': 'Ask for space',
  'warehouse.storage.from': 'From',
  'warehouse.storage.until': 'Until',
  'warehouse.storage.noteToFacility': 'Note to the facility',
  'warehouse.storage.sendRequest': 'Send request',
  'warehouse.storage.optionalShort': 'Optional.',

  /* Stock movements, mirroring MOVEMENT_LABEL in src/lib/fulfilment.ts.
   * "Goods in" and "Goods out" are the warehouse's own words for a direction
   * of travel, not an accounting credit/debit, and should translate as the
   * physical movement. */
  'warehouse.movement.arrival': 'Goods in',
  'warehouse.movement.release': 'Goods out',
  'warehouse.movement.adjustment': 'Adjustment',
  'warehouse.empty': 'No reservations yet',

  'booking.title': 'Bookings',
  'booking.myBookings': 'My Bookings',
  'booking.requestBooking': 'Request a booking',
  'booking.status.requested': 'Requested',
  'booking.status.accepted': 'Accepted',
  'booking.status.declined': 'Declined',
  'booking.status.completed': 'Completed',
  'booking.status.cancelled': 'Cancelled',
  'booking.empty': 'No bookings yet',
  'booking.emptyHint': 'Request a warehouse or logistics booking from the directory.',
  'booking.inboxEmpty': 'No booking requests yet',
  'booking.inboxEmptyHint': 'Requests for your service appear here. Publish a directory entry so members can find and book you.',

  'inspection.title': 'Inspections',
  'inspection.inspection': 'Inspection',
  'inspection.requestInspection': 'Request an inspection',
  'inspection.report': 'Inspection report',
  'inspection.recommendation': 'Recommendation',
  'inspection.accept': 'Accept - passes inspection',
  'inspection.reject': 'Reject',
  'inspection.status.requested': 'Requested',
  'inspection.status.assigned': 'Assigned',
  'inspection.status.in_progress': 'In progress',
  'inspection.status.submitted': 'Submitted',
  'inspection.status.accepted': 'Accepted',
  'inspection.empty': 'No inspections yet',

  'directory.title': 'Service directory',
  'directory.allServices': 'All services',
  'directory.warehouses': 'Warehouses',
  'directory.logistics': 'Logistics',
  'directory.empty': 'Nothing in the directory yet',
  // --- Wave A.3: transport status (shared with the supplier board) ---------
  'logistics.transportStatus.broadcast': 'Broadcast',
  'logistics.transportStatus.assigned': 'Assigned',
  'logistics.transportStatus.picked_up': 'Picked up',
  'logistics.transportStatus.in_transit': 'In transit',
  'logistics.transportStatus.delivered': 'Delivered',
  'logistics.transportStatus.completed': 'Completed',
  'logistics.transportStatus.cancelled': 'Cancelled',
} as const
