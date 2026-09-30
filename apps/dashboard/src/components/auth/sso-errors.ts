/** Map `sso_error` reasons from the OAuth callback redirect to user-facing copy. */
export function describeSsoError(reason: string): string {
  switch (reason) {
    case 'no_email':
      return 'The identity provider did not share an email address for this account. Use an account with a verified email.';
    case 'email_mismatch':
      return 'That Google or Microsoft account uses a different email than this Bokito account.';
    case 'subject_taken':
      return 'That Google or Microsoft account is already linked to another Bokito user.';
    case 'provisioning_failed':
      return 'We could not set up your account after sign-in. Please try again or contact support.';
    case 'token_exchange_failed':
      return 'Sign-in could not be completed. Please try again.';
    case 'state_expired':
    case 'expired_state':
      return 'The sign-in request expired. Please try again.';
    case 'access_denied':
      return 'Sign-in was cancelled.';
    default:
      return 'Sign-in failed. Please try again.';
  }
}
