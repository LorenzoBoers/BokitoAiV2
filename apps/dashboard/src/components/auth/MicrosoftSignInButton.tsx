import { Loader2 } from 'lucide-react'
import { describeSsoError } from './sso-errors'
import { MicrosoftLogo } from './provider-logos'
import { Button } from '../ui/button'

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
    <Button variant="secondary" size="lg"
      type="button"
      onClick={onClick}
      disabled={disabled || isLoading}
      className="w-full gap-2.5"
    >
      {isLoading ? <Loader2 size={16} className="animate-spin" /> : <MicrosoftLogo />}
      {label}
    </Button>
  )
}
