/**
 * The Loamy Privacy Policy — the single source of truth.
 *
 * WHY THIS IS DATA AND NOT JSX
 *
 *   Legal text changes after legal review, not after a design review. Keeping
 *   it as plain strings means a lawyer's edit is a content diff rather than a
 *   React change, and it means NOTHING here is ever interpreted as HTML —
 *   every string below is rendered as text, so policy content cannot become an
 *   injection surface even if it is later edited by someone outside the team.
 *
 * WHY THE VERSION LIVES HERE TOO
 *
 *   The consent record stores the policy version it was given against. If the
 *   policy changes materially, bumping POLICY_VERSION is the whole mechanism
 *   for asking people again: no migration, no cache to clear, no second place
 *   to remember. See src/lib/consent.ts.
 *
 * WHAT THIS DOCUMENT IS NOT
 *
 *   It is not a generic SaaS policy. Every claim below was checked against the
 *   codebase, and processing Loamy does not actually do has been left out
 *   rather than included "to be safe" — a policy that describes collection
 *   that does not happen is not a conservative choice, it is a false
 *   statement. Items that need a lawyer's eye are listed in
 *   NEEDS_LEGAL_REVIEW at the bottom.
 */

// ---------------------------------------------------------------------------
// Version metadata — the ONLY place these values are defined.
// ---------------------------------------------------------------------------

/**
 * Bump on a MATERIAL change. Everyone who has already given preferences is
 * shown the notice again, and their previous record is kept.
 */
export const POLICY_VERSION = '1.0'

/** Human-facing "last updated" date. Never hard-code this anywhere else. */
export const POLICY_EFFECTIVE_DATE = '2026-09-20'

/**
 * Bump when the CATEGORIES a person can choose between change. Separate from
 * the policy version because wording changes and choice changes are different
 * events: re-asking for a typo fix trains people to click through.
 */
export const CONSENT_VERSION = '1'

/** Bump when the notice itself changes materially (wording or controls). */
export const NOTICE_VERSION = '1'

// ---------------------------------------------------------------------------
// Who we are. Taken from contact details already configured in the app
// (src/pages/public/PublicMarketplace.tsx, src/pages/public/PublicShell.tsx).
// Nothing here is invented.
// ---------------------------------------------------------------------------

export const OPERATOR = {
  product: 'Loamy',
  company: 'Braventi Techworks',
  group: 'Braventi Holdings',
  website: 'https://braventiholdings.com.ng',
  supportEmail: 'support@loamy.ng',
  whatsapp: '+234 704 276 8655',
  whatsappUrl: 'https://wa.me/2347042768655',
} as const

/** Where a privacy request goes. The configured support address, not a new one. */
export const PRIVACY_CONTACT = OPERATOR.supportEmail

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

export interface PolicyBullet {
  /** Optional lead-in, rendered in bold before the text. */
  term?: string
  text: string
}

export interface PolicySection {
  /** Stable anchor id. Changing one breaks inbound links, so treat as an API. */
  id: string
  heading: string
  body?: string[]
  bullets?: PolicyBullet[]
  /** Set apart visually: something we want a reader not to miss. */
  callout?: string
}

export interface PolicyPart {
  id: string
  title: string
  sections: PolicySection[]
}

// ---------------------------------------------------------------------------
// The policy
// ---------------------------------------------------------------------------

export const PRIVACY_POLICY: PolicyPart[] = [
  {
    id: 'about',
    title: 'About this policy',
    sections: [
      {
        id: 'introduction',
        heading: 'Introduction',
        body: [
          'This policy explains what information Loamy collects, why we collect it, who we share it with, and what you can ask us to do about it. We have written it in plain language rather than legal boilerplate, because a policy nobody reads protects nobody.',
          'We have also kept it specific to what Loamy actually does. If something is not described here, we are not doing it.',
        ],
      },
      {
        id: 'who-we-are',
        heading: 'Who we are',
        body: [
          `Loamy is operated by ${OPERATOR.company}, a ${OPERATOR.group} company, in Nigeria. Loamy is an agricultural technology platform: digital identity, field verification, a commodity marketplace, traceability, and facilitation of financing and logistics.`,
          `For anything in this policy, contact us at ${OPERATOR.supportEmail} or on WhatsApp at ${OPERATOR.whatsapp}.`,
        ],
        callout:
          'Loamy is not a bank, not a lender and not a licensed financial institution. We do not make credit decisions and we do not hold your money.',
      },
      {
        id: 'scope',
        heading: 'Scope',
        body: [
          'This policy covers the Loamy web application, the public marketplace, member dashboards, and the field tools used by Growth Partners.',
          'It does not cover other websites we link to. When you open a link to a partner bank, a payment provider or any other third party, that organisation’s own privacy policy applies to what happens there.',
        ],
      },
    ],
  },

  {
    id: 'collect',
    title: 'Information we collect',
    sections: [
      {
        id: 'account',
        heading: 'Account and profile information',
        body: ['When you create an account, we collect what is needed to identify you on the platform:'],
        bullets: [
          { term: 'Your name, phone number and email address', text: 'used to create your account, sign you in and contact you about your activity.' },
          { term: 'Your role and state', text: 'farmer, trader, buyer, exporter, input supplier, warehouse owner, logistics provider or Growth Partner, and the state you operate in.' },
          { term: 'Your Loamy digital ID', text: 'a reference we generate for you. It is not a government identifier.' },
          { term: 'Optional profile details', text: 'a profile photograph, a public handle, a headline and a short bio, if you choose to add them.' },
        ],
        callout:
          'You control who can see your profile. The visibility setting on your account lets you choose between public, members-only and private, and Loamy honours that setting everywhere your profile appears.',
      },
      {
        id: 'business',
        heading: 'Business and marketplace information',
        body: ['If you trade on Loamy, we hold the information that makes a marketplace work:'],
        bullets: [
          { term: 'Listings', text: 'the commodity, quantity, unit, price, location, description and photographs you publish.' },
          { term: 'Enquiries and orders', text: 'the interest you express in a listing, what you agree, and the record of the transaction.' },
          { term: 'Directory and storefront details', text: 'your business information where you have chosen to appear in the supplier directory.' },
          { term: 'Reviews and ratings', text: 'feedback left about a completed transaction.' },
        ],
      },
      {
        id: 'farm',
        heading: 'Farm and agricultural information',
        body: ['If you register a farm, we hold the record you create about it:'],
        bullets: [
          { term: 'Farm details', text: 'the name, state, local government area, size in hectares, ownership type and the crops you grow.' },
          { term: 'A map pin', text: 'the farm coordinates, if you choose to place one. This is optional, and a farm works without it.' },
          { term: 'Production cycles and harvests', text: 'the seasons you record: crop, year, planting and harvest dates, expected and actual yield, and the quantity you harvested.' },
        ],
        callout:
          'Your season-by-season record is yours. It is visible to you and to Loamy administrators, and it is shared with a partner bank only when you submit a financing application.',
      },
      {
        id: 'batches',
        heading: 'Commodity, batch and transaction information',
        body: [
          'When you turn a harvest into a batch, Loamy records where that stock came from so a buyer can check its origin rather than take your word for it. A batch carries its commodity, quantity, grade, origin state and local government area, and the harvest and farm it came from.',
          'Every change to a batch - created, listed, reserved, sold, loaded, in transit, delivered - is recorded as an event with a timestamp and the person who caused it. This is what makes traceability possible, and it is why batch history cannot be quietly edited or deleted.',
        ],
      },
      {
        id: 'financing',
        heading: 'Financing information',
        body: [
          'If you apply for financing, we collect what the application needs: the amount and purpose, the farm or transaction it relates to, and the production history that supports it.',
        ],
        callout:
          'Loamy does not store your BVN or your NIN. Those columns do not exist in our database. Where a bank needs to verify your identity, you provide that information to the bank through the bank’s own process - not through Loamy. We record only whether a bank has told us that verification succeeded.',
      },
      {
        id: 'payout',
        heading: 'Payout account details',
        body: [
          'If you sell on Loamy and want to be paid, you can save a payout destination: the bank, the account number and the account name. We validate the account with our payment partner so that money is not sent to a mistyped number.',
          'This is a payout destination, not an identity record. It tells us where to send your money. It is not used to verify who you are, and it is not shared with anyone other than the payment provider that has to make the payment.',
        ],
      },
      {
        id: 'verification',
        heading: 'Verification and field-work information',
        body: [
          'Verification is a person physically visiting a farm or a store and recording what they find. When a Growth Partner carries out a verification, Loamy records:',
        ],
        bullets: [
          { term: 'Location at the moment of capture', text: 'the coordinates and accuracy reported by the agent’s device, and how far that is from the registered location.' },
          { term: 'Time', text: 'both the time the agent’s device reported and the time Loamy received it. The difference between the two is kept, because a device clock is not evidence.' },
          { term: 'Photographs and video', text: 'stored in a private, access-controlled area. The person being verified has no access to raw evidence.' },
          { term: 'Checklist answers and field notes', text: 'recorded against the version of the checklist the agent answered.' },
          { term: 'A device reference', text: 'a random value created once on the agent’s own device so a reviewer can see that several captures came from one handset. It is not derived from anything about the device, and it cannot be matched to that person on any other website.' },
        ],
        callout:
          'Location is captured at the moment an agent presses a button during field work. Loamy does not track anyone’s location in the background, and there is no code in the platform that could.',
      },
      {
        id: 'uploads',
        heading: 'Documents and files you upload',
        body: [
          'Depending on what you use, you may upload a profile photograph, listing photographs, verification or inspection evidence, and documents attached to a buy request. Verification and inspection evidence is held privately and reached only through short-lived links issued to people entitled to see it.',
        ],
        callout:
          'Please do not upload identity documents, bank statements or anything containing a BVN or NIN. Loamy does not need them and does not ask for them.',
      },
      {
        id: 'communications',
        heading: 'Communications and support',
        body: [
          'We keep the notifications we send you inside the platform, and we keep what you send us when you ask for help, so that we can answer and so there is a record of what was agreed.',
        ],
      },
      {
        id: 'usage',
        heading: 'How you use the marketplace',
        body: [
          'If you allow it, Loamy records what you search for and which listings and sellers you open, together with the commodity, state, quantity and price involved, and an opaque reference for your browsing session that is discarded when you close the tab.',
          'We use it for two things: to understand which parts of the product work, and to put more useful results in front of you - for example noting that supply exists in a state you do not usually search, or that you have bought a commodity before.',
        ],
        callout:
          'This is optional and it is off until you turn it on. Your email address, phone number, password, tokens and IP address are stripped from this record before it leaves your browser, and refused again by our database if they somehow arrive.',
      },
      {
        id: 'copilot',
        heading: 'Loamy Copilot',
        body: [
          'Loamy Copilot is an assistant that answers questions from data already on the platform. It is not currently enabled for members. When it is enabled, this is how it works:',
        ],
        bullets: [
          { text: 'You choose to use it. Nothing is sent to it unless you type a question.' },
          { text: 'It answers only from records you are already allowed to see. It cannot reach another member’s data.' },
          { text: 'It answers from Loamy’s own records rather than general knowledge, and it says which records an answer came from and how recent they are.' },
          { text: 'Your conversation is stored against your account so you can return to it, and so we can look into an answer that was wrong.' },
          { text: 'It does not forecast prices. It reports observed prices and observed patterns, and says so.' },
        ],
        callout:
          'Your Copilot conversations are not used to train any AI model. Please do not type information into Copilot that it does not need - particularly not bank identifiers, passwords or anything about another person.',
      },
      {
        id: 'technical',
        heading: 'Technical information',
        body: [
          'To keep your account secure and the service running, our infrastructure providers process the ordinary technical information any website receives, such as your IP address and browser type, and we keep a record of security-relevant actions taken in the platform, such as administrative changes and verification decisions.',
        ],
        callout:
          'We do not fingerprint your device, we do not build advertising profiles, and we do not collect your IP address for analytics.',
      },
    ],
  },

  {
    id: 'use',
    title: 'How we use information',
    sections: [
      {
        id: 'purposes',
        heading: 'What we use it for',
        bullets: [
          { term: 'Running your account', text: 'signing you in, keeping your session, showing you the right dashboard and keeping your account secure.' },
          { term: 'The marketplace', text: 'publishing your listings, matching buyers and sellers, and showing search results.' },
          { term: 'Transactions', text: 'processing an order, holding payment in escrow with our payment partner until you confirm receipt, and releasing it.' },
          { term: 'Financing', text: 'putting together an application and passing it to the partner bank you are applying to.' },
          { term: 'Verification', text: 'arranging a field visit, recording the evidence, and letting an independent reviewer decide.' },
          { term: 'Traceability', text: 'keeping the chain from farm to harvest to batch to sale, so a buyer can check where produce came from.' },
          { term: 'Logistics and storage', text: 'connecting you with transport and warehouse providers and coordinating a delivery.' },
          { term: 'Security and abuse prevention', text: 'detecting fraud, investigating disputes and enforcing our rules.' },
          { term: 'Improving the product', text: 'understanding which features are used and where people get stuck - only if you have allowed it.' },
        ],
      },
      {
        id: 'flags',
        heading: 'Checks on field work',
        body: [
          'Verification evidence is checked automatically for patterns worth a second look: a capture far from the registered location, a poor GPS fix, a device clock that is badly out, the same photograph filed against two different cases, or two captures too far apart to be reached in the time between them.',
          'These checks route a case to a human reviewer. They are not accusations, and no decision is ever made automatically - a person approves or declines every verification, and it is never the same person who collected the evidence.',
        ],
      },
    ],
  },

  {
    id: 'sharing',
    title: 'How information is shared',
    sections: [
      {
        id: 'never-sold',
        heading: 'We do not sell your information',
        body: [
          'Loamy does not sell personal information, does not share it with advertising networks, and does not trade in data. We share information only in the situations below.',
        ],
      },
      {
        id: 'with-members',
        heading: 'With other members',
        body: [
          'Your listings and the profile details you have made visible are shown to other members according to the visibility you chose. When you and another member agree to transact, each of you can see the other’s contact details - that is the point of the introduction, and it happens only after you both act.',
        ],
        callout:
          'A Growth Partner’s identity is never shown to the person being verified. They see Loamy, not an individual.',
      },
      {
        id: 'banks',
        heading: 'With banks and financial institutions',
        body: [
          'When you apply for financing, we share your application and the supporting record - your farm, production history and relevant transactions - with the partner bank you are applying to, because the bank cannot assess an application it cannot see.',
          'The bank is the lender and the decision-maker. Loamy facilitates the application; it does not approve, decline, price or disburse anything. Once your information reaches the bank, the bank’s own privacy policy and regulatory obligations apply to it.',
        ],
      },
      {
        id: 'payments',
        heading: 'With our payment provider',
        body: [
          'Marketplace payments are handled by Paystack, a licensed Nigerian payment provider. They process the payment and hold escrowed funds; Loamy never holds your money and never sees your card details. We share the payout account details you save so that they can be validated and paid.',
        ],
      },
      {
        id: 'field',
        heading: 'With field and service providers',
        bullets: [
          { term: 'Growth Partners', text: 'the agent assigned to a verification sees what they need to do the visit - the location, the stock and the checklist. They are not told which buyer requested the inspection.' },
          { term: 'Logistics and warehouse providers', text: 'when you arrange transport or storage, the provider receives the collection and delivery details needed to carry out the job.' },
          { term: 'Inspection providers', text: 'where a company arranges an inspection, the inspector receives the job details and records their findings.' },
        ],
      },
      {
        id: 'technology',
        heading: 'With technology providers',
        body: [
          'We use third parties to run the service. They process information on our instructions and for no purpose of their own:',
        ],
        bullets: [
          { term: 'Supabase', text: 'our database, authentication and file storage provider.' },
          { term: 'Paystack', text: 'payments, escrow and payout validation.' },
          { term: 'Open-Meteo', text: 'weather forecasts. When you view the forecast for a farm, that farm’s coordinates are sent to Open-Meteo to get the forecast. No account or personal detail is sent with it.' },
          { term: 'OpenStreetMap', text: 'map tiles. When a map is displayed, your browser requests the map images directly from OpenStreetMap, which means their servers see your IP address as they would for any website image.' },
        ],
      },
      {
        id: 'legal',
        heading: 'For legal reasons',
        body: [
          'We may disclose information where the law requires it, where a court or a regulator properly compels it, or where it is necessary to investigate fraud, protect someone from harm, or establish or defend a legal claim.',
        ],
      },
    ],
  },

  {
    id: 'rights',
    title: 'Your choices and rights',
    sections: [
      {
        id: 'your-rights',
        heading: 'Your rights',
        body: [
          'Under the Nigeria Data Protection Act, you have rights over your personal information. You can:',
        ],
        bullets: [
          { text: 'ask what we hold about you and get a copy;' },
          { text: 'ask us to correct anything that is wrong;' },
          { text: 'ask us to delete your account and your personal information;' },
          { text: 'object to processing, or ask us to restrict it;' },
          { text: 'withdraw a consent you gave, at any time, without affecting what was done before you withdrew it;' },
          { text: 'complain to the Nigeria Data Protection Commission if you think we have got it wrong.' },
        ],
      },
      {
        id: 'requests',
        heading: 'Making a privacy request',
        body: [
          `Email ${PRIVACY_CONTACT} from the address on your account, or message us on WhatsApp at ${OPERATOR.whatsapp}. We will ask enough to be sure it is really you, and no more.`,
          'We aim to answer within 30 days. If a request will take longer, we will tell you why and when to expect an answer.',
        ],
      },
      {
        id: 'deletion',
        heading: 'Deleting your account',
        body: [
          'You can ask us to close your account and delete your personal information. Some records cannot be deleted, and we would rather say so plainly than promise otherwise:',
        ],
        bullets: [
          { term: 'Completed transactions', text: 'the record of a deal you took part in belongs to the other party as well as to you, and we are required to keep financial records.' },
          { term: 'Traceability history', text: 'a batch’s history is what a buyer relied on. It is kept, and your personal details are removed from it where they are not needed to keep it meaningful.' },
          { term: 'Verification decisions', text: 'kept as an audit record of a decision that was made.' },
          { text: 'Everything else - your profile, your contact details, your drafts, your preferences - is deleted.' },
        ],
      },
      {
        id: 'preferences',
        heading: 'Privacy preferences',
        body: [
          'You can change your optional privacy preferences at any time, from the footer of the public site or from Settings inside the platform. Turning an option off stops that activity from then on.',
        ],
      },
    ],
  },

  {
    id: 'handling',
    title: 'How we look after information',
    sections: [
      {
        id: 'cookies',
        heading: 'Cookies and similar technologies',
        body: [
          'Loamy does not use advertising cookies and has no tracking pixels.',
          'We use browser storage - which behaves like a cookie but stays on your own device - for two kinds of thing:',
        ],
        bullets: [
          { term: 'Essential', text: 'keeping you signed in; remembering your cart; holding field evidence captured offline until it can be uploaded; holding market price submissions a Growth Partner records with no signal; remembering a referral code from the link you arrived on, until your account claims it; and remembering your privacy choices. These cannot be turned off, because without them the platform does not work.' },
          { term: 'Optional', text: 'the marketplace usage described above. This is off until you turn it on, and turning it off stops it.' },
        ],
      },
      {
        id: 'security',
        heading: 'Security',
        body: [
          'Every table in our database enforces access rules at the database itself, not merely in the application - so a request for data you are not entitled to returns nothing, regardless of how it is made. Evidence and document storage is private, reached only through short-lived links. Sensitive operations run as controlled server-side actions rather than direct writes, so records such as batch quantities and verification outcomes cannot be changed without an audit event beside them.',
          'No system is perfectly secure. If a breach affects your information, we will tell you and the Nigeria Data Protection Commission as the law requires.',
        ],
      },
      {
        id: 'retention',
        heading: 'How long we keep information',
        bullets: [
          { term: 'Your account', text: 'while your account is open, and for a reasonable period afterwards so it can be restored if you closed it by mistake.' },
          { term: 'Transactions and financial records', text: 'as long as the law requires us to keep financial records.' },
          { term: 'Verification evidence', text: 'for as long as the verification it supports is relied on, and then as an audit record of the decision.' },
          { term: 'Traceability history', text: 'for the life of the batch record, because a buyer relied on it.' },
          { term: 'Support messages', text: 'while needed to resolve the matter and for a reasonable period afterwards.' },
          { term: 'Optional usage records', text: 'used for recent activity only, and not kept indefinitely.' },
        ],
      },
      {
        id: 'international',
        heading: 'Processing outside Nigeria',
        body: [
          'Loamy is operated from Nigeria and serves Nigerian agriculture. Some of the technology providers listed above operate infrastructure outside Nigeria, which means your information may be processed abroad. Where that happens we rely on those providers’ contractual data-protection commitments, as the Nigeria Data Protection Act requires.',
        ],
      },
      {
        id: 'children',
        heading: 'Children',
        body: [
          'Loamy is a business platform for adults. It is not directed at children, and we do not knowingly collect information from anyone under 18. If you believe a child has created an account, contact us and we will remove it.',
        ],
      },
    ],
  },

  {
    id: 'changes',
    title: 'Changes and contact',
    sections: [
      {
        id: 'changes-to-policy',
        heading: 'Changes to this policy',
        body: [
          'We will update this policy as Loamy changes. The version and date at the top of the page always tell you which version you are reading.',
          'If we make a material change, we will show you the privacy notice again so you can read what changed and set your preferences afresh. We will not quietly change what we do with your information and rely on you noticing.',
        ],
      },
      {
        id: 'contact',
        heading: 'Contact us',
        body: [
          `Email: ${OPERATOR.supportEmail}`,
          `WhatsApp: ${OPERATOR.whatsapp}`,
          `${OPERATOR.company}, a ${OPERATOR.group} company - ${OPERATOR.website}`,
        ],
      },
    ],
  },
]

// ---------------------------------------------------------------------------
// The privacy notice. Kept here so the notice and the policy cannot drift.
// ---------------------------------------------------------------------------

export const NOTICE_COPY = {
  title: 'Your privacy',
  body:
    'Loamy uses essential browser storage to sign you in, keep your cart, and hold field evidence captured offline until it can be uploaded. That part cannot be switched off - without it the platform does not work.',
  optional:
    'Separately, we can record what you search for and which listings you open, to improve the product and put more useful results in front of you. That is optional and it is off unless you turn it on.',
  acceptAll: 'Accept all',
  essentialOnly: 'Essential only',
  manage: 'Manage preferences',
  save: 'Save preferences',
  policyLink: 'Read the Privacy Policy',
} as const

// ---------------------------------------------------------------------------
// Open questions for legal review.
// ---------------------------------------------------------------------------

/**
 * Deliberately exported so it is visible in review rather than buried in a
 * commit message. None of these block the implementation; all of them are
 * wording or fact that a lawyer, not an engineer, should settle.
 */
export const NEEDS_LEGAL_REVIEW: string[] = [
  'Registered entity name and RC number for Braventi Techworks, and whether Loamy should be named as a product of it or as a separate controller.',
  'Whether a Data Protection Officer must be appointed and named here under the NDPA 2023, and the NDPC registration status of the business.',
  'The lawful basis stated for each purpose (contract, legitimate interest, consent) - currently described in plain language rather than mapped to NDPA terms.',
  'Confirm the actual hosting region of the Supabase project, so the international-transfer section can name it rather than describing it generally.',
  'Concrete retention periods in months or years, in place of the current qualitative descriptions.',
  'The exact wording of what is retained after account deletion, and confirmation that removing personal identifiers from traceability history satisfies a deletion request.',
  'Whether a separate Terms of Service is required before launch, and how it should be referenced from here.',
  'Confirmation of the data-sharing terms actually agreed with each partner bank.',
]
