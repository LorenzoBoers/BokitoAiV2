import { Loader2 } from 'lucide-react'
import { GoogleLogo } from './provider-logos'
import { Button } from '../ui/button'

export function GoogleSignInButton({
  onClick,
  isLoading,
  disabled,
  label = 'Sign in with Google',
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
      {isLoading ? <Loader2 size={16} className="animate-spin" /> : <GoogleLogo />}
      {label}
    </Button>
  )
}
