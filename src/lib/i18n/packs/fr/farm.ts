import type { TranslationPack } from '../en'

/**
 * Français — exploitations, campagnes et récoltes.
 *
 * LE VOCABULAIRE AGRICOLE EST CELUI DU PRODUIT
 *   Une exploitation, une campagne, une récolte et un lot sont des choses
 *   distinctes aux conséquences distinctes. Une FICHE DE CAMPAGNE est ce que
 *   l'agriculteur déclare avoir semé et espère récolter ; une récolte réelle
 *   est ce qui est sorti du champ ; un LOT est du stock traçable portant une
 *   référence qu'un acheteur peut suivre. Les confondre effacerait la
 *   distinction entre DÉCLARÉ et VÉRIFIÉ, que glossary.md traite comme la
 *   seule qui doive survivre à toutes les langues.
 *
 * DÉCLARÉ N'EST PAS VÉRIFIÉ
 *   Tout ce que l'agriculteur saisit est une déclaration. Cela ne devient
 *   vérifié que lorsqu'un Partenaire de Croissance se rend sur la parcelle et
 *   recueille des preuves. Aucune de ces phrases ne doit laisser croire que
 *   l'enregistrement d'une exploitation vaut vérification.
 *
 * Non relu par un locuteur natif.
 */
export const frFarm: TranslationPack = {
  // --- les pages de l'agriculteur ------------------------------------------
  'farm.myFarms': 'Mes exploitations',
  'farm.allFarms': 'Toutes les exploitations',
  'farm.addFarm': 'Ajouter une exploitation',
  'farm.registerFarm': 'Enregistrer une exploitation',
  'farm.registerFarmShort': 'Enregistrer',
  'farm.editFarm': "Modifier l'exploitation",
  'farm.loadingFarms': 'Chargement des exploitations',
  'farm.loadingFarm': "Chargement de l'exploitation",
  'farm.noFarmsRegistered': 'Aucune exploitation enregistrée',
  'farm.noFarmsHint': "La vérification, le financement et la place de marché reposent tous sur votre profil d'exploitation.",
  'farm.notYours': "Cette exploitation n'existe pas ou ne vous appartient pas.",
  'farm.size': 'Superficie',
  'farm.location': 'Emplacement',
  'farm.crops': 'Cultures',
  'farm.tenure': 'Mode de faire-valoir',
  'farm.addLocation': 'Ajouter un emplacement',
  'farm.noGpsYet': 'Aucun point GPS pour le moment. En ajouter un renforce la vérification.',

  // --- chiffres du tableau de bord -----------------------------------------
  'farm.totalFarms': 'Exploitations',
  'farm.verifiedFarms': 'Exploitations vérifiées',
  'farm.totalHectares': 'Hectares au total',
  'farm.activeApplications': 'Demandes en cours',
  'farm.fieldVerified': 'vérifiées sur le terrain',
  'farm.registeredPlots': 'parcelles enregistrées',
  'farm.acrossAllFarms': 'toutes exploitations confondues',
  'farm.withPartnerBanks': 'auprès des banques partenaires',
  'farm.noActivityYet': "Aucune activité pour le moment. Enregistrez une exploitation pour commencer.",
  'farm.yieldHistoryTitle': 'Historique des rendements - kg réels par campagne (votre dossier de crédit se construit)',
  'farm.actualYieldKg': 'Rendement réel (kg)',
  'farm.other': 'Autre',

  // --- fiches de campagne ---------------------------------------------------
  'farm.cropRecords': 'Fiches de campagne',
  'farm.addRecord': 'Ajouter une fiche',
  'farm.saveRecord': 'Enregistrer la fiche',
  'farm.noCropRecords': "Aucune fiche de campagne pour le moment. L'historique campagne par campagne construit l'antécédent que les banques partenaires consultent.",
  'farm.crop': 'Culture *',
  'farm.seasonYear': 'Année de campagne *',
  'farm.plantingDate': 'Date de semis',
  'farm.expectedYieldKg': 'Rendement attendu (kg)',
  'farm.expectedHarvest': 'Récolte attendue',
  'farm.actualHarvest': 'Récolte réelle',
  'farm.notes': 'Notes',
  'farm.notesPlaceholder': 'Tout ce qui est notable sur cette campagne',
  'farm.selectPlaceholder': 'Sélectionner…',

  // --- récolte ---------------------------------------------------------------
  'farm.recordHarvest': 'Enregistrer la récolte',
  'farm.saveHarvest': 'Enregistrer la récolte',
  'farm.harvestDate': 'Date de récolte *',
  'farm.quantity': 'Quantité *',
  'farm.unit': 'Unité',
  'farm.qualityGrade': 'Qualité',
  'farm.qualityGradePlaceholder': 'ex. Grade A',
  'farm.whereStockHeld': 'Où le stock est entreposé',
  'farm.storagePlaceholder': 'Magasin personnel, marché, entrepôt…',
  // Un LOT est du stock traçable, ce qui n'est pas la même chose qu'une fiche
  // de récolte. La phrase explique pourquoi en créer un compte.
  'farm.batchExplainer': "Un lot reçoit une référence que les acheteurs peuvent tracer, et peut être vendu comme approvisionnement vérifié.",
  'farm.manageInMyStock': 'Gérer dans Mes stocks',

  // --- état de vérification, tel que l'agriculteur le voit ------------------
  'farm.verificationProgress': 'Avancement de la vérification',
  'farm.verificationRequested': "La vérification a été demandée. Une visite de terrain sera organisée - vous serez informé à chaque étape.",
  'farm.verifiedByVisit': "Cette exploitation a été vérifiée lors d'une visite de terrain.",
  'farm.notVerifiedYet': "Cette exploitation n'a pas encore été vérifiée. Les exploitations vérifiées pèsent davantage auprès des banques partenaires et des acheteurs.",
  'farm.verificationUnsuccessful': 'Vérification non concluante',
  'farm.verificationUnsuccessfulHint': "La dernière tentative de vérification n'a pas abouti. Vérifiez les informations de votre exploitation et demandez une nouvelle vérification.",
  'farm.decisionUnsuccessful': 'Décision - non concluante (vous pouvez redemander)',
  'farm.anotherVisitRequested': 'Visite de terrain - une nouvelle visite a été demandée',
  'farm.status.unverified': 'Non vérifiée',
  'farm.status.pending': 'Vérification en attente',
  'farm.status.verified': 'Vérifiée',
  'farm.status.rejected': 'Vérification non concluante',

  // --- mode de faire-valoir -------------------------------------------------
  'farm.ownership.owned': 'En propriété',
  'farm.ownership.leased': 'En location',
  'farm.ownership.family': 'Terre familiale',

  // --- le formulaire ---------------------------------------------------------
  'farm.farmName': "Nom de l'exploitation *",
  'farm.namePlaceholder': 'ex. Ferme Alheri',
  'farm.sizeHectares': 'Superficie (hectares) *',
  'farm.ownership': 'Mode de faire-valoir *',
  'farm.primaryCrops': 'Cultures principales *',
  'farm.state': 'État *',
  'farm.selectState': 'Choisir un État…',
  'farm.lga': 'Collectivité locale (LGA) *',
  'farm.lgaPlaceholder': 'ex. Zaria',
  'farm.addressDirections': 'Adresse / indications',
  'farm.directionsPlaceholder': "Points de repère ou indications pour accéder à l'exploitation (facultatif)",
  'farm.farmLocation': "Emplacement de l'exploitation",
  'farm.latitude': 'Latitude',
  'farm.longitude': 'Longitude',
  'farm.useMyLocation': 'Utiliser ma position',
  'farm.saveChanges': 'Enregistrer les modifications',
  'farm.gpsHint': "Relevez le GPS sur place, cliquez sur la carte, ou saisissez les coordonnées. L'emplacement renforce la vérification ultérieure.",
  'farm.coordinatesIncomplete': 'Coordonnées incomplètes ou hors limites',
  'farm.couldNotSave': "L'exploitation n'a pas pu être enregistrée.",
  'farm.locationDenied': "Accès à la position refusé - cliquez sur la carte ou saisissez les coordonnées.",
  'farm.locationFailed': "Impossible d'obtenir votre position - cliquez sur la carte ou saisissez les coordonnées.",
  'farm.validation.nameRequired': "Le nom de l'exploitation est obligatoire.",
  'farm.validation.sizePositive': 'La superficie doit être supérieure à zéro.',
  'farm.validation.lgaRequired': 'La collectivité locale (LGA) est obligatoire.',
  'farm.validation.stateRequired': "L'État est obligatoire.",
  'farm.validation.cropsRequired': 'Sélectionnez au moins une culture principale.',
  'farm.validation.bothCoordinates': 'Indiquez la latitude ET la longitude, ou aucune des deux.',
  'farm.validation.coordinatesRange': 'Coordonnées hors limites.',

  // --- financement, expliqué sur le tableau de bord -------------------------
  // La banque décide et verse. Loamy ne détient ni ne déplace de fonds.
  'farm.howFinancingWorks': 'Comment fonctionne le financement sur Loamy',
  'farm.financingExplainer': "Vous faites votre demande via Loamy avec votre profil d'exploitation vérifié ; la décision de financement conforme à la charia et le versement se font entièrement auprès de la banque partenaire. Loamy ne détient ni ne déplace jamais de fonds.",
}
