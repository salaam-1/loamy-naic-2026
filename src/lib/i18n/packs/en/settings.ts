/**
 * Settings, including the authenticated language control.
 *
 * The language card deliberately explains WHERE the preference is kept, because
 * a member who changes language on a shared device should know the choice
 * follows their account rather than the browser.
 */
export const settings = {
  'settings.title': 'Settings',
  'settings.profile': 'Profile',
  'settings.account': 'Account',
  'settings.password': 'Password',
  'settings.identityVerification': 'Identity verification',
  'settings.publicHandle': 'Public handle',
  'settings.payoutAccount': 'Payout account',
  'settings.myRoles': 'My roles',

  'settings.yourPublicHandle': 'Your public handle',
  'settings.handleHelp': 'How people find and link to you on Loamy. You can change it once every 30 days.',
  'settings.username': 'Username',
  'settings.viewYourProfile': 'View your profile',
  'settings.whoCanSee': 'Who can see your profile',
  'settings.yourRoles': 'Your roles',
  'settings.detailsNotFilled': 'Details not filled in yet.',
  'settings.switchTo': 'Switch',
  'settings.addAnotherRole': 'Add another role',
  'settings.addRole': 'Add role',
  'settings.addRoleHelp': 'You will fill in a few details for the new role, then land on its dashboard.',
  'settings.whereYouGetPaid': 'Where you get paid',
  'settings.saveProfile': 'Save profile',
  'settings.language': 'Language',
  'settings.languageHelp': 'Choose the language Loamy uses for you. It applies everywhere you are signed in, on any device.',
  'settings.languageSaved': 'Language updated.',
  'settings.languageSaveFailed': 'We could not save your language. Your choice still applies on this device.',
  'settings.languageSelectAria': 'Choose your language',
  'settings.languageCoverageNote': 'Some areas of Loamy are still being translated and will appear in English until they are ready.',

  'settings.fullName': 'Full name',
  'settings.phone': 'Phone number',
  'settings.email': 'Email address',
  'settings.state': 'State',
  'settings.headline': 'Headline',
  'settings.bio': 'About',
  'settings.avatar': 'Profile photo',
  'settings.changePhoto': 'Change profile photo',
  'settings.changePassword': 'Change password',
  'settings.currentPassword': 'Current password',
  'settings.newPassword': 'New password',
  'settings.confirmPassword': 'Confirm new password',
  'settings.profileSaved': 'Your profile has been updated.',
} as const
