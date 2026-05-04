import { AlertCircle } from 'lucide-react'
import type { ValidationError } from '../../types/custom-db'

export function ValidationFeedback({ 
  errors, 
  className = '' 
}: { 
  errors: ValidationError[]
  className?: string 
}) {
  if (errors.length === 0) return null

  return (
    <div className={`flex items-start gap-1 text-xs text-status-error ${className}`}>
      <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
      <div className="space-y-0.5">
        {errors.map((error, idx) => (
          <div key={idx}>{error.message}</div>
        ))}
      </div>
    </div>
  )
}

export function InlineValidationFeedback({ 
  errors, 
  show = true 
}: { 
  errors: ValidationError[]
  show?: boolean 
}) {
  if (!show || errors.length === 0) return null

  return (
    <div className="absolute top-full left-0 mt-0.5 z-10 bg-status-error/10 border border-status-error/20 rounded px-2 py-1 text-xs text-status-error max-w-xs">
      {errors[0].message}
    </div>
  )
}