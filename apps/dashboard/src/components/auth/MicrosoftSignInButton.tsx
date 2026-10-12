import { Loader2 } from 'lucide-react'
import { describeSsoError } from './sso-errors'
import { MicrosoftLogo } from './provider-logos'

export { describeSsoError }

export function MicrosoftSignInButton({
  onClick,
  isLoading,
  disabled,
  label = 'Sign in with Microsoft',
}: {
  onClick: () => void
  isLoading?: boolean
  disabled?: boolean
  label?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || isLoading}
      className="flex w-full items-center justify-center gap-2.5 rounded-md border border-border bg-bg-input px-4 py-2.5 text-sm font-medium text-text-primary transition hover:border-border-focus disabled:cursor-not-allowed disabled:opacity-60"
    >
      {isLoading ? <Loader2 size={16} className="animate-spin" /> : <MicrosoftLogo />}
      {label}
    </button>
  )
}
