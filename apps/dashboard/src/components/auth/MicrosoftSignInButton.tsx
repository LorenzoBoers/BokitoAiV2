import { Loader2 } from 'lucide-react';
import { describeSsoError } from './sso-errors';

export { describeSsoError };

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
