/**
 * Farms, crop records and harvest.
 *
 * THE AGRICULTURAL VOCABULARY IS THE PRODUCT'S VOCABULARY
 *   A farm, a crop cycle, a season, a harvest and a batch are distinct things
 *   with distinct consequences, and the trust model rests on telling them
 *   apart. A crop RECORD is what a farmer says they planted and expect; an
 *   actual harvest is what came off the field; a BATCH is traceable stock with
 *   a reference a buyer can follow. Collapsing any two of those in translation
 *   would blur the line between declared and verified, which glossary.md
 *   treats as the one distinction that must survive every language.
 *
 * DECLARED IS NOT VERIFIED
 *   Everything a farmer types here is a declaration. It becomes verified only
 *   when a Growth Partner stands on the land and captures evidence. The
 *   verification copy says which state a farm is in, and must never read as
 *   though registering a farm verified it.
 *
 * WHAT STAYS AS DATA
 *   Farm names, LGAs, states, crop names chosen from the taxonomy, quantities,
 *   units, grades, coordinates and batch references are the record. They are
 *   interpolated, never translated.
 */
export const farm = {
  // --- the farmer's own pages ----------------------------------------------
  'farm.myFarms': 'My farms',
  'farm.allFarms': 'All farms',
  'farm.addFarm': 'Add farm',
  'farm.registerFarm': 'Register a farm',
  'farm.registerFarmShort': 'Register farm',
  'farm.editFarm': 'Edit farm',
  'farm.loadingFarms': 'Loading farms',
  'farm.loadingFarm': 'Loading farm',
  'farm.noFarmsRegistered': 'No farms registered',
  'farm.noFarmsHint': 'Verification, financing, and the marketplace all build on your farm profile.',
  'farm.notYours': 'This farm does not exist or is not yours.',
  'farm.size': 'Size',
  'farm.location': 'Location',
  'farm.crops': 'Crops',
  'farm.addLocation': 'Add location',
  'farm.noGpsYet': 'No GPS point yet. Adding one strengthens verification.',

  // --- dashboard figures ----------------------------------------------------
  'farm.totalFarms': 'Total Farms',
  'farm.verifiedFarms': 'Verified Farms',
  'farm.totalHectares': 'Total Hectares',
  'farm.activeApplications': 'Active Applications',
  'farm.fieldVerified': 'field-verified',
  'farm.noActivityYet': 'No activity yet. Register a farm to get started.',
  'farm.yieldHistoryTitle': 'Yield history - actual kg per season (your credit file growing)',
  'farm.actualYieldKg': 'Actual yield (kg)',
  'farm.other': 'Other',

  // --- crop records ---------------------------------------------------------
  // A record is a DECLARATION about a season. The expected figure is a plan;
  // the actual figure is what was harvested. Two different claims, two labels.
  'farm.cropRecords': 'Crop records',
  'farm.addRecord': 'Add record',
  'farm.saveRecord': 'Save record',
  'farm.noCropRecords': 'No crop records yet. Season-by-season history builds the track record partner banks will look at.',
  'farm.crop': 'Crop *',
  'farm.seasonYear': 'Season year *',
  'farm.plantingDate': 'Planting date',
  'farm.expectedYieldKg': 'Expected yield (kg)',
  'farm.expectedHarvest': 'Expected harvest',
  'farm.actualHarvest': 'Actual harvest',
  'farm.notes': 'Notes',
  'farm.notesPlaceholder': 'Anything notable about this season',
  'farm.selectPlaceholder': 'Select…',

  // --- harvest --------------------------------------------------------------
  'farm.recordHarvest': 'Record harvest',
  'farm.saveHarvest': 'Save harvest',
  'farm.harvestDate': 'Harvest date *',
  'farm.quantity': 'Quantity *',
  'farm.unit': 'Unit',
  'farm.qualityGrade': 'Quality grade',
  'farm.qualityGradePlaceholder': 'e.g. Grade A',
  'farm.whereStockHeld': 'Where the stock is held',
  'farm.storagePlaceholder': 'Own store, market, warehouse…',
  // A batch is traceable stock, which is a different thing from a harvest
  // record. The sentence exists to explain why recording one matters.
  'farm.batchExplainer': 'A batch gets a reference buyers can trace, and can be sold as verified supply.',
  'farm.manageInMyStock': 'Manage in My Stock',

  // --- verification state, as the farmer sees it ---------------------------
  // Registering a farm does not verify it. These say which state it is in,
  // and none of them may read as though the farmer has verified it himself.
  'farm.verificationProgress': 'Verification progress',
  'farm.verificationRequested': 'Verification has been requested. A field visit will be arranged - you will be notified at each step.',
  'farm.verifiedByVisit': 'This farm has been verified through a field visit.',
  'farm.notVerifiedYet': 'This farm has not been verified yet. Verified farms carry more weight with partner banks and buyers.',
  'farm.verificationUnsuccessful': 'Verification unsuccessful',
  'farm.verificationUnsuccessfulHint': 'The last verification attempt was unsuccessful. Review your farm details and request verification again.',
  'farm.decisionUnsuccessful': 'Decision - unsuccessful (you can request again)',
  'farm.anotherVisitRequested': 'Field visit - another visit was requested',

  // --- ownership (the values are a fixed taxonomy, the words are wording) ---
  'farm.ownership.owned': 'Owned',
  'farm.ownership.leased': 'Leased',
  'farm.ownership.family': 'Family land',

  // --- the farm form --------------------------------------------------------
  'farm.namePlaceholder': 'e.g. Alheri Farm',
  'farm.lgaPlaceholder': 'e.g. Zaria',
  'farm.directionsPlaceholder': 'Landmarks or directions to the farm (optional)',
  // Validation. The RULES are unchanged; only their wording is looked up.
  'farm.validation.nameRequired': 'Farm name is required.',
  'farm.validation.sizePositive': 'Farm size must be greater than zero.',
  'farm.validation.lgaRequired': 'LGA is required.',
  'farm.validation.bothCoordinates': 'Provide both latitude and longitude, or neither.',
  'farm.validation.coordinatesRange': 'Coordinates are out of range.',

  // --- financing explainer shown on the farmer dashboard -------------------
  // Loamy is the channel. The bank decides and the bank disburses.
  'farm.howFinancingWorks': 'How financing works on Loamy',
  // --- Wave A.2: farmer dashboard ------------------------------------------
  'farm.registeredPlots': 'registered plots',
  'farm.acrossAllFarms': 'across all farms',
  'farm.withPartnerBanks': 'with partner banks',
  'farm.financingExplainer': 'You apply through Loamy with your verified farm profile; the Shariah-compliant financing decision and disbursement happen entirely at the partner bank. Loamy never holds or moves funds.',
  // --- Wave A.2: the farm form ---------------------------------------------
  'farm.tenure': 'Tenure',
  'farm.farmName': 'Farm name *',
  'farm.sizeHectares': 'Size (hectares) *',
  'farm.ownership': 'Ownership *',
  'farm.primaryCrops': 'Primary crops *',
  'farm.state': 'State *',
  'farm.selectState': 'Select state…',
  'farm.lga': 'Local Government Area (LGA) *',
  'farm.addressDirections': 'Address / directions',
  'farm.farmLocation': 'Farm location',
  'farm.latitude': 'Latitude',
  'farm.longitude': 'Longitude',
  'farm.useMyLocation': 'Use my location',
  'farm.saveChanges': 'Save changes',
  'farm.gpsHint': 'Capture GPS at the farm, click the map, or type coordinates. Location strengthens verification later.',
  'farm.coordinatesIncomplete': 'Coordinates incomplete or out of range',
  'farm.validation.cropsRequired': 'Select at least one primary crop.',
  'farm.validation.stateRequired': 'State is required.',
  'farm.couldNotSave': 'Could not save the farm.',
  'farm.locationDenied': 'Location permission denied - click the map or type coordinates instead.',
  'farm.locationFailed': 'Could not get your location - click the map or type coordinates instead.',
  // --- Wave A.2: farm verification status, mirroring VERIFICATION_META -----
  'farm.status.unverified': 'Not verified',
  'farm.status.pending': 'Verification pending',
  'farm.status.verified': 'Verified',
  'farm.status.rejected': 'Verification unsuccessful',
} as const
