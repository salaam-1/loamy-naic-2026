/**
 * Sign in, sign up, password and session copy.
 *
 * Error text here is deliberately non-specific about WHICH credential was
 * wrong, because saying so tells an attacker whether an account exists. The
 * translations must keep that vagueness rather than "improve" it.
 */
export const auth = {
  // --- password reset -------------------------------------------------------
  'auth.setNewPassword': 'Set a new password',
  'auth.setNewPasswordHint': "Choose a strong password you haven't used before.",
  'auth.newPassword': 'New password',
  'auth.confirmNewPassword': 'Confirm new password',
  'auth.atLeast8': 'At least 8 characters',
  'auth.repeatPassword': 'Repeat the password',
  'auth.updatePassword': 'Update password',
  'auth.linkExpired': 'Link expired',
  'auth.linkExpiredHint': 'This reset link is invalid or has expired. Request a new one.',
  'auth.requestNewLink': 'Request a new link',
  'auth.resetEmailHint': "We'll email you a secure link to set a new password.",
  'auth.sendResetLink': 'Send reset link',
  // The sentence is deliberately non-committal about whether the account
  // exists: saying so would turn the reset form into an account-enumeration
  // oracle. A translation must keep the "if" and must not become
  // "we have sent you a link".
  'auth.ifAccountExists': 'If an account exists for {email}, a reset link is on its way.',

  // --- sign up --------------------------------------------------------------
  'auth.backToSignIn': 'Back to sign in',
  'auth.checkYourEmail': 'Check your email',
  'auth.checkYourEmailHint': 'One more step to activate your account.',
  'auth.confirmationSent': 'We sent a confirmation link to {email}. Click it, then sign in to continue your onboarding.',
  'auth.createFreeAccount': 'Create a free account to contact this seller.',
  'auth.selectRole': 'Select a role…',
  'auth.selectState': 'Select your state…',
  'auth.createAccount': 'Create account',
  'auth.emailPlaceholder': 'you@example.com',
  // Says only what is true: creating an account does not grant optional
  // analytics, and there is no Terms of Service in this codebase to claim.
  'auth.privacyConsent': 'By creating an account you agree that Loamy may process your information as described in our',
  'auth.privacyPolicy': 'Privacy Policy',
  'auth.analyticsStayOff': 'Optional analytics stay off unless you choose to turn them on.',

  'auth.signIn': 'Sign in',
  'auth.signUp': 'Create account',
  'auth.signOut': 'Sign out',
  'auth.email': 'Email address',
  'auth.password': 'Password',
  'auth.confirmPassword': 'Confirm password',
  'auth.fullName': 'Full name',
  'auth.phone': 'Phone number',
  'auth.state': 'State',
  'auth.forgotPassword': 'Forgot your password?',
  'auth.resetPassword': 'Reset password',
  'auth.noAccount': 'New to Loamy?',
  'auth.haveAccount': 'Already have an account?',
  'auth.createOne': 'Create an account',

  'auth.signingIn': 'Signing you in…',
  'auth.creatingAccount': 'Creating your account…',
  'auth.invalidCredentials': 'That email and password do not match an account.',
  'auth.accountInactive': 'This account is not active.',
  'auth.checkEmail': 'A confirmation email was sent to {email}.',
  'auth.resetSent': 'If that address has an account, a reset link is on its way.',
  'auth.sessionEnded': 'Your session has ended. Sign in again to continue.',

  'auth.sentConfirmationTo': 'We sent a confirmation link to',
  'auth.createYourAccount': 'Create your Loamy account',
  'auth.createToContactSeller': 'Create a free account to contact this seller.',
  'auth.yourRole': 'Your role on the platform',
  'auth.resetYourPassword': 'Reset your password',
  'auth.namePlaceholder': 'e.g. Amina Bello',
  'auth.phonePlaceholder': 'e.g. 0803 123 4567',
  'auth.passwordPlaceholder': 'At least 8 characters',
  'auth.tagline': 'Nigeria’s Agricultural Operating System',
  'auth.welcomeBack': 'Welcome back',
  'auth.welcomeBackNamed': 'Welcome back, {name}',
} as const
