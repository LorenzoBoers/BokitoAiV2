import { Loader2 } from 'lucide-react';

/** Map `sso_error` reasons from the OAuth callback redirect to user-facing copy. */
export function describeSsoError(reason: string): string {
  switch (reason) {
    case 'no_email':
      return 'Microsoft did not share an email address for this account. Use an account with a verified email.';
    case 'provisioning_failed':
      return 'We could not set up your account after Microsoft sign-in. Please try again or contact support.';
    case 'token_exchange_failed':
      return 'Microsoft sign-in could not be completed. Please try again.';
    case 'state_expired':
      return 'The sign-in request expired. Please try again.';
    case 'access_denied':
      return 'Microsoft sign-in was cancelled.';
    default:
      return 'Microsoft sign-in failed. Please try again.';
  }
}

function MicrosoftLogo() {
  return (
    <svg width="16" height="16" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

export function MicrosoftSignInButton({
  onClick,
  isLoading,
  disabled,
  label = 'Sign in with Microsoft',
}: {
  onClick: () => void;
  isLoading?: boolean;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || isLoading}
      className="w-full flex items-center justify-center gap-2.5 px-4 py-2.5 rounded-md text-sm font-medium text-text-primary bg-bg-input border border-border hover:border-border-focus disabled:opacity-60 disabled:cursor-not-allowed transition"
    >
      {isLoading ? <Loader2 size={16} className="animate-spin" /> : <MicrosoftLogo />}
      {label}
    </button>
  );
}
