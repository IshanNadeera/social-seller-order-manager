import type { SourceChannel } from '@ssom/shared';

// Every piece of user-facing text lives here, so Sinhala and Tamil can be added later
// without hunting through components (docs/DEVELOPMENT.md §6.9).
// Labels for shared codes are typed with Record<Code, string>, so a code added to
// @ssom/shared without a label here is a type error.

const sourceChannelLabels: Record<SourceChannel, string> = {
  FACEBOOK: 'Facebook',
  INSTAGRAM: 'Instagram',
  TIKTOK: 'TikTok',
  WHATSAPP: 'WhatsApp',
  PHONE: 'Phone call',
  WALK_IN: 'Walk-in',
  WEBSITE: 'Website',
  OTHER: 'Other',
};

export const strings = {
  appName: 'Social Seller Order Manager',
  common: {
    loading: 'Loading…',
  },
  layout: {
    logOut: 'Log out',
    loggingOut: 'Logging out…',
    logOutFailed: 'We couldn’t log you out. Please try again.',
  },
  notices: {
    passwordChanged: 'Your password has been changed.',
  },
  dashboard: {
    title: 'Dashboard',
    empty: 'Your orders will show up here.',
  },
  notFound: {
    title: 'Page not found',
    body: 'We couldn’t find that page. It may have moved, or the link may be wrong.',
    backHome: 'Go to the dashboard',
  },
  auth: {
    fields: {
      email: 'Email',
      password: 'Password',
      newPassword: 'New password',
      confirmPassword: 'Confirm password',
      passwordHint: 'At least 8 characters.',
    },
    validation: {
      emailRequired: 'Enter your email address.',
      emailInvalid: 'Enter a valid email address, like name@example.com.',
      passwordRequired: 'Enter your password.',
      passwordTooShort: 'Use at least 8 characters.',
      passwordTooLong: 'Use 72 characters or fewer.',
      passwordsDontMatch: 'The two passwords don’t match.',
    },
    login: {
      title: 'Log in',
      submit: 'Log in',
      submitting: 'Logging in…',
      forgotPassword: 'Forgot your password?',
      noAccount: 'New here?',
      signUpLink: 'Create an account',
      resendConfirmation: 'Send the confirmation email again',
      confirmationResent: 'We sent a new confirmation link. Check your inbox.',
    },
    signUp: {
      title: 'Create your account',
      submit: 'Create account',
      submitting: 'Creating account…',
      haveAccount: 'Already have an account?',
      logInLink: 'Log in',
    },
    checkEmail: {
      title: 'Check your email',
      body: (email: string) =>
        `We sent a confirmation link to ${email}. Open it to finish creating your account.`,
      spamHint: 'Can’t find it? Check your spam folder, or send it again.',
      resend: 'Send the email again',
      resending: 'Sending…',
      resent: 'We sent a new link. It can take a minute to arrive.',
      useDifferentEmail: 'Use a different email',
    },
    forgot: {
      title: 'Reset your password',
      intro: 'Enter your email and we’ll send you a link to choose a new password.',
      submit: 'Send reset link',
      submitting: 'Sending…',
      sentTitle: 'Check your email',
      // Same message whether or not an account exists, so the form can't be used to find accounts.
      sent: (email: string) =>
        `If there is an account for ${email}, we sent it a link to reset the password. The link works once and expires in an hour.`,
      backToLogin: 'Back to log in',
    },
    confirm: {
      verifying: 'Checking your link…',
      invalidTitle: 'This link doesn’t work',
      invalidBody: 'The link is incomplete. Open it again from the email, or request a new one.',
      expiredTitle: 'This link has expired',
      expiredBody: 'Links work once and expire after an hour. Request a new one below.',
      requestNewReset: 'Send a new reset link',
      goToLogin: 'Go to log in',
    },
    reset: {
      title: 'Choose a new password',
      submit: 'Save new password',
      submitting: 'Saving…',
      noSessionTitle: 'This reset link has expired',
      noSessionBody: 'Request a new link to choose a new password.',
      requestNew: 'Send a new reset link',
    },
    errors: {
      invalidCredentials: 'The email or password is incorrect.',
      emailNotConfirmed: 'Please confirm your email first. Open the link we sent you.',
      weakPassword: 'Choose a stronger password: at least 8 characters, and not a common one.',
      samePassword: 'Choose a password that is different from your current one.',
      tooManyRequests: 'Too many attempts. Please wait a few minutes and try again.',
      linkExpired: 'This link has expired or was already used.',
      signUpDisabled: 'New sign-ups are closed at the moment.',
      network: 'We can’t reach the server. Check your internet connection and try again.',
      generic: 'Something went wrong. Please try again.',
    },
  },
  api: {
    unauthorized: 'Your session has ended. Please log in again.',
    forbidden: 'You don’t have access to this.',
    notFound: 'We couldn’t find that. It may have been removed.',
    rateLimited: 'Too many requests. Please wait a moment and try again.',
    serverError: 'Something went wrong on our side. Please try again.',
    network: 'We can’t reach the server. Check your internet connection and try again.',
    timeout: 'The server is taking too long to answer. Check your connection and try again.',
    generic: 'Something went wrong. Please try again.',
    reference: (requestId: string) => `Reference: ${requestId}`,
  },
  account: {
    loadFailedTitle: 'We couldn’t load your account',
    retry: 'Try again',
    retrying: 'Trying again…',
  },
  onboarding: {
    title: 'Set up your business',
    intro: 'A few details to get started. You can change them later in Settings.',
    businessName: 'Business name',
    businessNameHint: 'The name your customers know you by.',
    contactPhone: 'Contact phone (optional)',
    contactPhoneHint: 'For your own records. Customers don’t see it in this app.',
    orderPrefix: 'Order number prefix',
    orderPrefixHint: '2 to 6 letters or numbers. Every order number starts with it.',
    prefixPreview: (first: string, second: string) =>
      `Your first order will be ${first}, then ${second}, and so on.`,
    submit: 'Continue',
    submitting: 'Setting up…',
  },
  sourceChannel: sourceChannelLabels,
} as const;
