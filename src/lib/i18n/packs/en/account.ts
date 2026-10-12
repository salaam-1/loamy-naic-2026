/**
 * Public profiles, privacy, notifications, onboarding and support.
 *
 * PRIVACY COPY
 *   The privacy strings here are summaries shown in the interface. The policy
 *   document itself (src/content/legal) is a legal instrument, not interface
 *   copy, and is NOT translated by this system: a translated policy would be a
 *   second legal text with no legal review behind it. The UI says which
 *   language the policy is available in instead.
 */
export const account = {
  'profile.title': 'Profile',
  'profile.publicProfile': 'Public profile',
  'profile.handle': 'Public handle',
  'profile.handleHelp': 'Your @handle is how buyers find you on Loamy.',
  'profile.handleInstitutional': 'A public handle is for marketplace members. Institutional accounts do not have one.',
  'profile.visibility': 'Who can see this',
  'profile.visibilityPublic': 'Anyone',
  'profile.visibilityMembers': 'Signed-in members',
  'profile.visibilityPrivate': 'Only me',
  'profile.notFound': 'That profile is not available.',
  'profile.memberSince': 'Member since {date}',
  'profile.reviews': 'Reviews',
  'profile.noReviews': 'No reviews yet',

  'privacy.title': 'Privacy',
  'privacy.yourData': 'Your data',
  'privacy.downloadData': 'Download your data',
  'privacy.deleteAccount': 'Delete your account',
  'privacy.consentEssential': 'Essential only',
  'privacy.consentAll': 'Accept all',
  'privacy.cookieNotice': 'Loamy uses essential cookies to keep you signed in.',
  'privacy.policyLanguageNote': 'The privacy policy is published in English. It is a legal document and is not machine-translated.',

  'notifications.title': 'Notifications',
  'notifications.empty': 'Nothing yet',
  'notifications.emptyHint': 'Verification updates, financing progress and platform news will land here.',
  'notifications.markRead': 'Mark as read',
  'notifications.markAllRead': 'Mark all as read',
  'notifications.unreadCount': '{count} unread',

  'onboarding.title': 'Welcome to Loamy',
  'onboarding.chooseRole': 'What do you do?',
  'onboarding.chooseRoleHelp': 'You can add other roles later.',
  'onboarding.tellUsMore': 'Tell us a little more',
  'onboarding.finish': 'Finish setting up',
  'onboarding.complete': 'Your profile is ready.',
  'onboarding.alreadyComplete': 'Onboarding is already complete. Use the role switcher to change role.',

  'support.title': 'Support',
  'support.contactUs': 'Contact us',
  'support.subject': 'Subject',
  'support.message': 'Message',
  'support.send': 'Send message',
  'support.sent': 'Your message has been sent.',
  'support.empty': 'No support messages yet',
} as const
