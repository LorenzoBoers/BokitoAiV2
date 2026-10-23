import { Spinner } from '../ui/spinner'
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
      {isLoading ? <Spinner size="md" /> : <MicrosoftLogo />}
      {label}
    </Button>
  )
}
