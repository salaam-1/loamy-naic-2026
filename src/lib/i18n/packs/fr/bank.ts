import type { TranslationKey } from '../en'

/**
 * Le portail bancaire : l'interface d'un chargé de financement.
 *
 * LOAMY N'EST PAS LE PRÊTEUR, ET C'EST ICI QUE CE FAIT SE PERD LE PLUS VITE
 *   Un chargé de financement lit ces mots en consignant une décision portant
 *   sur l'argent d'autrui. Chacun d'eux doit préserver quatre faits :
 *
 *     - c'est la BANQUE qui décide. Loamy enregistre ce que la banque a décidé
 *       et n'approuve, ne refuse ni ne tarife jamais rien.
 *     - Loamy ne détient aucun fonds. Le versement et le règlement passent par
 *       les circuits de la banque, hors plateforme. Un chiffre de « portefeuille »
 *       ici est un enregistrement reflété, pas un solde que Loamy contrôle.
 *     - un montant APPROUVÉ n'est pas un montant VERSÉ. Ce sont deux colonnes
 *       et deux événements distincts, et une traduction qui les confond annonce
 *       au chargé que l'argent a bougé alors qu'il n'a pas bougé.
 *     - un montant DEMANDÉ est ce que le demandeur a sollicité. Ce n'est ni une
 *       promesse, ni une offre, ni un droit acquis.
 *
 * LE VOCABULAIRE DES STATUTS N'EST PAS ICI
 *   `financing.status.*` porte déjà les treize statuts, et
 *   `financing.statusHint.*` ce que chacun signifie pour le demandeur. Ils sont
 *   réutilisés, jamais recréés : un second jeu de mots pour les mêmes treize
 *   états, et le portail et le tableau de bord finissent par décrire
 *   différemment une seule et même ligne.
 *
 * CE QUI RESTE DES DONNÉES
 *   Noms de demandeurs, de sociétés et de banques, identifiants numériques,
 *   références de dossier, de facilité, de compte et de transaction, adresses,
 *   noms de fichiers, notes du chargé et la référence propre de la banque.
 *   Interpolés, jamais traduits.
 *
 * REVUE
 *   Traduit, PAS encore relu par un locuteur natif. Voir REVIEW_STATUS.
 */
export const bank: Partial<Record<TranslationKey, string>> = {
  // --- navigation -----------------------------------------------------------
  'nav.pipeline': 'Demandes de financement',
  'nav.loans': 'Prêts',
  'nav.customers': 'Clients',
  'nav.collateral': 'Garanties',
  'nav.disbursements': 'Versements',
  'nav.repayments': 'Remboursements',
  'nav.risk': 'Risque et conformité',
  'nav.alerts': 'Alertes',
  'nav.monitoring': 'Suivi',
  'bank.roleOfficer': 'Chargé de financement',

  // --- classification du risque --------------------------------------------
  'bank.riskTier.Low': 'Faible',
  'bank.riskTier.Medium': 'Moyen',
  'bank.riskTier.High': 'Élevé',
  'bank.riskTier.Very High': 'Très élevé',

  // --- tableau de bord ------------------------------------------------------
  'bank.home.submitted': 'Soumises',
  'bank.home.submittedSub': 'en attente d’un premier examen',
  'bank.home.inReview': 'En cours d’examen',
  'bank.home.inReviewSub': 'en examen / information demandée',
  'bank.home.requestedPipeline': 'Demandé (en cours)',
  'bank.home.requestedPipelineSub': 'sollicité · pas des fonds détenus',
  'bank.home.reportsGenerated': 'Rapports générés',
  'bank.home.reportsGeneratedSub': 'renseignement de crédit',
  'bank.home.facilitiesMonitored': 'Facilités suivies',
  'bank.home.facilitiesMonitoredSub': 'avec jalons',
  'bank.home.loanPortfolio': 'Portefeuille de prêts',
  'bank.home.activeFacilities': '{count} facilité active',
  'bank.home.activeFacilities_plural': '{count} facilités actives',
  'bank.home.disbursedMtd': 'Versé (mois en cours)',
  'bank.home.disbursedMtdSub': 'enregistré, circuits bancaires',
  'bank.home.borrowers': 'Emprunteurs',
  'bank.home.borrowersSub': 'avec facilités actives',
  'bank.home.par30': 'PAR 30+',
  'bank.home.par30Sub': 'principal en retard de 30 jours ou plus',
  'bank.home.portfolioBySector': 'Portefeuille par secteur',
  'bank.home.topBorrowers': 'Principaux emprunteurs par exposition',
  'bank.home.pipelineByStatus': 'Dossiers par statut',
  'bank.home.applicationsWeekly': 'Demandes reçues (par semaine)',
  'bank.home.applications': 'Demandes',
  'bank.home.riskTierDistribution': 'Répartition par niveau de risque',
  'bank.home.recentPipeline': 'Dossiers récents',
  'bank.home.noApplications': 'Aucune demande pour l’instant. Les demandes soumises par les membres Loamy apparaîtront ici.',
  'bank.home.topApplicants': 'Principaux demandeurs par montant sollicité',
  'bank.home.requestedNotOutstanding': 'Montants sollicités via Loamy - et non des encours. Le versement et le règlement ont lieu à la banque, hors plateforme.',

  // --- colonnes partagées ---------------------------------------------------
  'bank.col.applicant': 'Demandeur',
  'bank.col.amount': 'Montant',
  'bank.col.requested': 'Demandé',
  'bank.col.risk': 'Risque',
  'bank.col.status': 'Statut',
  'bank.col.customer': 'Client',
  'bank.col.due': 'Échéance',
  'bank.col.amountDue': 'Montant dû',
  'bank.col.daysOverdue': 'Jours de retard',
  'bank.col.reference': 'Référence',
  'bank.col.date': 'Date',
  'bank.col.type': 'Type',
  'bank.col.paid': 'Payé',
  'bank.col.action': 'Action',
  'bank.col.actions': 'Actions',
  'bank.col.kind': 'Nature',
  'bank.col.description': 'Description',
  'bank.col.estValue': 'Valeur est.',
  'bank.col.logged': 'Enregistré le',
  'bank.col.facilities': 'Facilités',
  'bank.col.activeExposure': 'Exposition active',
  'bank.col.facility': 'Facilité',
  'bank.col.principal': 'Principal',
  'bank.col.sector': 'Secteur',
  'bank.col.opened': 'Ouverte le',
  'bank.col.note': 'Note',
  'bank.col.report': 'Rapport',
  'bank.col.riskTier': 'Niveau de risque',
  'bank.col.generated': 'Généré le',
  'bank.col.identityVerified': 'Identité vérifiée',
  'bank.col.product': 'Produit',
  'bank.col.state': 'État',
  'bank.col.submitted': 'Soumise le',

  // --- file des demandes ----------------------------------------------------
  'bank.pipeline.title': 'Dossiers',
  'bank.pipeline.filterProduct': 'Filtrer par produit',
  'bank.pipeline.allProducts': 'Tous les produits',
  'bank.pipeline.inputFinancing': 'Financement d’intrants',
  'bank.pipeline.filterState': 'Filtrer par État',
  'bank.pipeline.allStates': 'Tous les États',
  'bank.pipeline.filterTier': 'Filtrer par niveau de risque',
  'bank.pipeline.allTiers': 'Tous les niveaux',
  'bank.pipeline.filterStatus': 'Filtrer par statut',
  'bank.pipeline.allStatuses': 'Tous les statuts',
  'bank.pipeline.loading': 'Chargement des dossiers',
  'bank.pipeline.noneForInstitution': 'Aucune demande pour votre institution pour l’instant.',
  'bank.pipeline.noneMatchFilters': 'Aucune demande ne correspond aux filtres.',
  // « approuvé » précède un SECOND montant sous celui demandé. Les deux ne sont
  // jamais présentés comme un seul chiffre.
  'bank.pipeline.approvedPrefix': 'approuvé {amount}',

  // --- décision -------------------------------------------------------------
  'bank.decision.under_review': 'Mettre en examen',
  'bank.decision.under_reviewIntent': 'Indiquer au demandeur que son dossier est en cours d’évaluation.',
  'bank.decision.additional_information_required': 'Demander des informations',
  'bank.decision.additional_information_requiredIntent': 'Demandez au demandeur ce qu’il vous faut. Il voit ce message.',
  'bank.decision.approved': 'Approuver',
  'bank.decision.approvedIntent': 'Consigner l’approbation de votre institution et ses conditions.',
  'bank.decision.partially_approved': 'Approuver en partie',
  'bank.decision.partially_approvedIntent': 'Approuver moins que le montant demandé, en précisant ce que vous financez.',
  'bank.decision.rejected': 'Refuser',
  'bank.decision.rejectedIntent': 'Consigner la décision de refus de votre institution.',
  'bank.decision.recordAction': 'Consigner : {action}',
  'bank.decision.under_reviewLower': 'mettre en examen',
  'bank.decision.additional_information_requiredLower': 'demander des informations',
  'bank.decision.approvedLower': 'approuver',
  'bank.decision.partially_approvedLower': 'approuver en partie',
  'bank.decision.rejectedLower': 'refuser',
  'bank.decision.title': 'Décision',
  'bank.decision.sandboxWarning': 'Mode bac à sable : ceci est une donnée de test, pas une décision de crédit, et n’engage aucun fonds. Le demandeur la voit signalée comme une simulation.',
  'bank.decision.liveNote': 'Mode réel : le demandeur est informé que la décision vient de votre institution.',
  'bank.decision.noneOpen': 'Aucune décision n’est ouverte sur cette demande. Son statut est {status}.',
  'bank.decision.approvedAmount': 'Montant approuvé (₦)',
  'bank.decision.requestedHint': '{amount} demandés. C’est votre institution qui fixe le montant.',
  'bank.decision.messageRequired': 'Message au demandeur (obligatoire)',
  'bank.decision.noteOptional': 'Note au demandeur',
  'bank.decision.whyDeclined': 'Pourquoi cette demande a été refusée.',
  'bank.decision.whatNeeded': 'Ce que le demandeur doit fournir.',
  'bank.decision.optional': 'Facultatif.',
  'bank.decision.tenorDays': 'Durée (jours)',
  'bank.decision.optionalPlaceholder': 'Facultatif',
  'bank.decision.yourReference': 'Votre référence',
  'bank.decision.pricing': 'Tarification',
  'bank.decision.pricingPlaceholder': 'Telle que votre institution l’exprime',
  'bank.decision.pricingNote': 'Enregistrée telle quelle. Loamy n’a aucune politique tarifaire propre.',
  'bank.decision.conditions': 'Conditions',
  'bank.decision.conditionsPlaceholder': 'Facultatif. Conditions attachées à cette approbation.',
  'bank.decision.giveReason': 'Donnez un motif. Le demandeur est informé du résultat dans tous les cas ; un refus sans motif ne lui sert à rien.',
  'bank.decision.writeWhatYouNeed': 'Écrivez ce qu’il vous faut de la part du demandeur. Il voit ce message.',
  'bank.decision.checkTenor': 'Vérifiez la durée.',

  // --- validation -----------------------------------------------------------
  'bank.validation.enterApprovedAmount': 'Saisissez le montant approuvé.',
  'bank.validation.enterANumber': 'Saisissez un nombre.',
  'bank.validation.amountAboveZero': 'Une approbation exige un montant supérieur à zéro.',
  'bank.validation.amountNotAboveRequested': 'Une approbation ne peut pas dépasser les {requested} demandés.',
  'bank.validation.tenorWholeNumber': 'La durée est un nombre entier de jours.',
  'bank.validation.tenorAboveZero': 'La durée doit être supérieure à zéro jour.',

  // --- conditions de règlement ---------------------------------------------
  'bank.condition.bank_approved': 'L’institution n’a pas encore approuvé cette demande.',
  'bank.condition.approval_current': 'L’approbation a expiré. Soumettez une nouvelle demande, ou payez directement.',
  'bank.condition.supplier_direct_supported': 'Cette institution ne paie pas les vendeurs directement.',
  'bank.condition.transaction_live': 'L’achat n’est plus actif.',
  'bank.condition.commodity_verified': 'Un agent Loamy doit encore inspecter la marchandise.',
  'bank.condition.verification_current': 'La dernière inspection est trop ancienne et doit être refaite.',
  'bank.condition.seller_payout_ready': 'Le vendeur n’a pas indiqué à Loamy où envoyer le règlement.',
  'bank.condition.no_blocking_flags': 'Un signalement non résolu sur l’inspection doit être examiné.',
  'bank.condition.not_over_committed': 'Il est engagé plus de marchandise qu’il n’en existe.',
  'bank.condition.not_already_settled': 'Cette demande a déjà été réglée.',

  // --- règlement au fournisseur --------------------------------------------
  'bank.settlement.title': 'Règlement au fournisseur',
  'bank.settlement.sandboxNote': 'Cette demande est une simulation en bac à sable. Tout ce qui est enregistré ici est une donnée de test et ne déplace aucun argent.',
  'bank.settlement.settledToSeller': '{amount} enregistrés comme réglés au vendeur.',
  'bank.settlement.institutionPaysDirect': 'Votre institution paie le vendeur directement. Loamy enregistre la référence et passe une écriture pour mémoire - elle ne détient ni ne déplace jamais les fonds.',
  'bank.settlement.outstandingBefore': 'À régler avant le règlement',
  'bank.settlement.conditionsNotMet': 'Les conditions ne sont pas encore réunies.',
  'bank.settlement.amountPaid': 'Montant payé (₦)',
  'bank.settlement.yourReference': 'Votre référence de paiement',
  'bank.settlement.note': 'Note',
  'bank.settlement.notePlaceholder': 'Facultatif.',
  'bank.settlement.record': 'Consigner le règlement',
  'bank.settlement.enterAmount': 'Saisissez le montant payé par votre institution.',
  'bank.settlement.enterReference': 'Saisissez la référence de paiement propre à votre institution.',
  'bank.settlement.couldNotRead': 'Les conditions de règlement n’ont pas pu être lues.',
  'bank.settlement.couldNotRecord': 'Le règlement n’a pas pu être enregistré.',
  'bank.settlement.duplicateReference': 'Cette référence a déjà été enregistrée. Rien n’a été passé deux fois.',
  'bank.settlement.conditionsNotMetYet': 'Les conditions de règlement ne sont pas encore réunies. Les points en attente sont listés ci-dessus.',
  'bank.settlement.recordedNotice': 'Règlement enregistré au grand livre comme écriture pour mémoire. Loamy ne détient aucun fonds.',
  'bank.settlement.referenceHint': 'La référence propre à l’institution. Enregistrer deux fois la même est refusé.',

  // --- secteurs (la valeur stockée reste anglaise) --------------------------
  'bank.sector.Agriculture Production': 'Production agricole',
  'bank.sector.Agri-processing': 'Transformation agroalimentaire',
  'bank.sector.Trading & Distribution': 'Négoce et distribution',
  'bank.sector.Equipment Financing': 'Financement d’équipement',
  'bank.sector.Other': 'Autre',

  // --- échéances ------------------------------------------------------------
  'bank.repaymentStatus.upcoming': 'À venir',
  'bank.repaymentStatus.paid': 'Payée',
  'bank.repaymentStatus.partial': 'Partielle',
  'bank.repaymentStatus.overdue': 'En retard',
  'bank.facilityStatus.active': 'active',
  'bank.facilityStatus.closed': 'clôturée',
  'bank.facilityStatus.written_off': 'passée en perte',
  'bank.warning.missedMilestones': '{count} jalon manqué',
  'bank.warning.missedMilestones_plural': '{count} jalons manqués',
  'bank.warning.overdueMilestones': '{count} jalon en retard non encore mis à jour',
  'bank.warning.overdueMilestones_plural': '{count} jalons en retard non encore mis à jour',
  'bank.decisionSupportOnly': 'Aide à la décision uniquement. Toutes les décisions de financement relèvent de la Banque.',
  'bank.riskRuleBased': 'Classification du risque - fondée sur des règles, à partir des enregistrements de la plateforme.',

  // --- détail de la facilité ------------------------------------------------
  'bank.facility.loading': 'Chargement de la facilité',
  'bank.facility.notFound': 'Facilité introuvable pour votre banque.',
  'bank.facility.backToLoans': 'Prêts',
  'bank.facility.openedOn': 'ouverte le {date}',
  'bank.facility.principal': 'Principal',
  'bank.facility.disbursed': 'Versé',
  'bank.facility.repaid': 'Remboursé',
  'bank.facility.outstanding': 'Encours',
  'bank.facility.disbursements': 'Versements',
  'bank.facility.amount': 'Montant',
  'bank.facility.date': 'Date',
  'bank.facility.bankReference': 'Référence bancaire',
  'bank.facility.referencePlaceholder': 'ex. TXN-…',
  'bank.facility.record': 'Consigner',
  'bank.facility.noDisbursements': 'Aucun versement enregistré pour l’instant.',
  'bank.facility.invalidAmount': 'Saisissez un montant de versement valide.',
  'bank.facility.repaymentSchedule': 'Échéancier de remboursement',
  'bank.facility.noSchedule': 'Aucun échéancier défini. Les échéances peuvent être ajoutées à l’activation d’une facilité.',
  'bank.facility.colDue': 'Échéance',
  'bank.facility.colAmountDue': 'Montant dû',
  'bank.facility.colPaid': 'Payé',
  'bank.facility.colAction': 'Action',
  'bank.facility.recordPayment': 'Consigner un paiement',
  'bank.facility.collateral': 'Garanties',
  'bank.facility.kind': 'Nature',
  'bank.facility.kindPlaceholder': 'ex. Récépissé d’entrepôt',
  'bank.facility.description': 'Description',
  'bank.facility.estValue': 'Valeur est.',
  'bank.facility.add': 'Ajouter',
  'bank.facility.noCollateral': 'Aucune garantie enregistrée.',
  'bank.facility.recordRepayment': 'Consigner un remboursement',
  'bank.facility.amountPaid': 'Montant payé',
  'bank.facility.instalmentHint': 'Échéance du {date} · {amount}',

  // --- rapport de crédit ----------------------------------------------------
  'bank.report.loading': 'Chargement du rapport',
  'bank.report.notFound': 'Rapport introuvable ou inaccessible.',
  'bank.report.backToApplication': 'Demande',
  'bank.report.print': 'Imprimer / enregistrer en PDF',
  'bank.report.reportId': 'Rapport {id}',
  'bank.report.generatedOn': 'Généré le {date}',
  'bank.report.applicationId': 'Demande {id}',
  'bank.report.identitySection': 'Identité et vérification',
  'bank.report.fullName': 'Nom complet',
  'bank.report.digitalId': 'Identifiant numérique',
  'bank.report.state': 'État',
  'bank.report.memberSince': 'Membre depuis',
  'bank.report.phone': 'Téléphone',
  'bank.report.identityBadge': 'Badge d’identité',
  'bank.report.verifiedThroughField': 'Vérifié par un contrôle de terrain',
  'bank.report.notVerified': 'Non vérifié',
  'bank.report.productionSection': 'Profil de production',
  'bank.report.noSeasonRecords': 'Aucun enregistrement de saison au dossier.',
  'bank.report.farm': 'Exploitation',
  'bank.report.season': 'Saison',
  'bank.report.crop': 'Culture',
  'bank.report.expectedKg': 'Prévu (kg)',
  'bank.report.actualKg': 'Réel (kg)',
  'bank.report.activitySection': 'Signaux d’activité',
  'bank.report.activeListings': 'Annonces actives sur la place de marché :',
  'bank.report.financingSection': 'Contexte de financement',
  'bank.report.requestedLabel': 'Demandé :',
  'bank.report.supplierPayment': 'paiement fournisseur (la banque paie les fournisseurs directement)',
  'bank.report.riskSection': 'Classification du risque',
  'bank.report.productLine': 'Financement d’intrants · Murabaha (coût majoré, sans intérêt) · Versement :',
  'bank.report.purpose': 'Objet : {purpose}',
  'bank.report.itemisedUse': 'Utilisation détaillée : {items}',
  'bank.report.priorApplications': 'Demandes antérieures : {list}',
  'bank.report.monitoredMilestones': 'Jalons suivis : {met} atteints, {missed} manqués, {upcoming} à venir',
  'bank.report.score': 'score {score}',

  // --- alertes --------------------------------------------------------------
  'bank.alerts.loading': 'Chargement des alertes',
  'bank.alerts.noneTitle': 'Aucune alerte active',
  'bank.alerts.noneBody': 'Les échéances en retard et les facilités à risque apparaîtront ici.',

  // --- garanties ------------------------------------------------------------
  'bank.collateral.loading': 'Chargement des garanties',
  'bank.collateral.noneTitle': 'Aucune garantie enregistrée',
  'bank.collateral.noneBody': 'Enregistrez une garantie sur une facilité depuis Prêts.',

  // --- clients --------------------------------------------------------------
  'bank.customers.loading': 'Chargement des clients',
  'bank.customers.noneTitle': 'Aucun client pour l’instant',
  'bank.customers.noneBody': 'Les emprunteurs apparaissent ici dès que vous ouvrez des facilités à partir de demandes décidées.',

  // --- versements -----------------------------------------------------------
  'bank.disbursements.loading': 'Chargement des versements',
  'bank.disbursements.noneTitle': 'Aucun versement enregistré',
  'bank.disbursements.noneBody': 'Enregistrez les versements confirmés par la banque depuis une facilité, sous Prêts.',

  // --- transactions ---------------------------------------------------------
  'bank.transactions.loading': 'Chargement des transactions',
  'bank.transactions.noneTitle': 'Aucune transaction pour l’instant',
  'bank.transactions.noneBody': 'Les versements et remboursements enregistrés sur les facilités apparaîtront ici.',
  'bank.transactions.disbursement': 'Versement',
  'bank.transactions.repayment': 'Remboursement',

  // --- remboursements -------------------------------------------------------
  'bank.repayments.title': 'Remboursements',
  'bank.repayments.loading': 'Chargement des remboursements',
  'bank.repayments.filterStatus': 'Filtrer par statut',
  'bank.repayments.allStatuses': 'Tous les statuts',
  'bank.repayments.noneTitle': 'Aucune échéance',
  'bank.repayments.noneBody': 'Les échéanciers sont définis à l’activation d’une facilité.',
  'bank.repayments.record': 'Consigner',

  // --- prêts et activation --------------------------------------------------
  'bank.loans.loading': 'Chargement des facilités',
  'bank.loans.noneTitle': 'Aucune facilité pour l’instant',
  'bank.loans.noneBody': 'Activez une demande décidée ci-dessus pour ouvrir une facilité gérée.',
  'bank.loans.activateFacility': 'Activer la facilité',
  'bank.loans.principalConfirmed': 'Principal (confirmé par la banque)',
  'bank.loans.sector': 'Secteur',
  'bank.loans.optionalSchedule': 'Échéancier de remboursement facultatif',
  'bank.loans.instalments': 'Échéances',
  'bank.loans.firstDue': 'Première échéance',
  'bank.loans.amountPerInstalment': 'Montant / échéance',
  'bank.loans.openFacility': 'Ouvrir la facilité',
  'bank.loans.invalidPrincipal': 'Saisissez un principal valide.',

  // --- suivi ----------------------------------------------------------------
  'bank.monitoring.title': 'Facilités suivies',
  'bank.monitoring.loading': 'Chargement des facilités',
  'bank.monitoring.type': 'Type',
  'bank.monitoring.instalmentMurabaha': 'Échéance (Murabaha)',
  'bank.monitoring.deliverySalam': 'Livraison (Salam)',
  'bank.monitoring.dueDate': 'Date d’échéance',
  'bank.monitoring.note': 'Note',
  'bank.monitoring.dueRequired': 'La date d’échéance est obligatoire.',
  'bank.monitoring.markMissed': 'Manqué',
  'bank.monitoring.markMet': 'Atteint',
  'bank.monitoring.add': 'Ajouter',
  'bank.monitoring.optionalPlaceholder': 'Facultatif',
  'bank.monitoring.noDecided': 'Aucune facilité décidée pour l’instant. Marquez d’abord une décision comme communiquée dans les dossiers.',
  'bank.monitoring.earlyWarning': 'Alerte précoce : {warnings}',
  'bank.milestoneStatus.met': 'atteint',
  'bank.milestoneStatus.missed': 'manqué',
  'bank.milestoneStatus.upcoming': 'à venir',

  // --- rapports -------------------------------------------------------------
  'bank.reports.title': 'Rapports de renseignement de crédit',
  'bank.reports.loading': 'Chargement des rapports',
  'bank.reports.noneYet': 'Aucun rapport pour l’instant. Générez-en un depuis une demande dans les dossiers.',

  // --- risque et conformité -------------------------------------------------
  'bank.risk.portfolioAtRisk': 'Portefeuille à risque',
  'bank.risk.portfolioAtRiskSub': 'PAR 30+ / principal',
  'bank.risk.par30': 'PAR 30+',
  'bank.risk.par30Sub': 'principal en retard de 30 jours ou plus',
  'bank.risk.activePrincipal': 'Principal actif',
  'bank.risk.activePrincipalSub': 'facilités gérées',
  'bank.risk.unverifiedBorrowers': 'Emprunteurs non vérifiés',
  'bank.risk.unverifiedBorrowersSub': 'des facilités actives',
  'bank.risk.complianceTitle': 'Conformité - statut de vérification des emprunteurs',
  'bank.risk.noActiveFacilities': 'Aucune facilité active.',
  'bank.risk.verified': 'Vérifié',
  'bank.risk.notVerified': 'Non vérifié',

  // --- messages -------------------------------------------------------------
  'bank.messages.comingTitle': 'La messagerie arrive',
  'bank.messages.comingBody': 'La messagerie directe entre la banque, les demandeurs et l’équipe Loamy est prévue. Pour l’instant, utilisez les coordonnées du demandeur sur un dossier accepté, ou contactez l’équipe Loamy via le support.',

  // --- détail de la demande -------------------------------------------------
  'bank.detail.couldNotLoad': 'Cette demande n’a pas pu être chargée.',
  'bank.detail.reportFailed': 'Le rapport n’a pas pu être généré.',
  // --- Wave A.5 correction: the farm line in the credit report -------------
  'bank.report.hectares': '{size} ha',
  'bank.report.fieldVerified': 'vérifié sur le terrain',
  'bank.report.verifiedOnDate': ' le {date}',
  'bank.report.atGps': ' au GPS {lat}, {lng}',
  'bank.report.verificationStatus': 'statut de vérification : {status}',
}
