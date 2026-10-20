import * as React from 'react'
import { AlertCircle, CheckCircle } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Input } from './input'
import { Label } from './label'

interface ValidationError {
  field: string
  message: string
}

interface ValidatedInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string
  error?: string
  success?: boolean
  helpText?: string
  required?: boolean
}

/** Labelled <Input> with an inline error or success state. */
export function ValidatedInput({
  label,
  error,
  success,
  helpText,
  required,
  className,
  id,
  ...props
}: ValidatedInputProps) {
  const autoId = React.useId()
  const inputId = id ?? autoId
  const hasError = !!error
  const hasSuccess = success && !hasError

  return (
    <div className="space-y-1.5">
      <Label htmlFor={inputId}>
        {label}
        {required ? <span className="ml-1 text-status-error">*</span> : null}
      </Label>
      <div className="relative">
        <Input
          id={inputId}
          aria-invalid={hasError || undefined}
          className={cn(
            (hasError || hasSuccess) && 'pr-9',
            hasError && 'border-status-error focus:border-status-error',
            hasSuccess && 'border-status-success focus:border-status-success',
            className,
          )}
          {...props}
        />
        {hasError || hasSuccess ? (
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
            {hasError ? <AlertCircle className="h-4 w-4 text-status-error" aria-hidden /> : null}
            {hasSuccess ? <CheckCircle className="h-4 w-4 text-status-success" aria-hidden /> : null}
          </div>
        ) : null}
      </div>
      {error ? (
        <p className="flex items-center gap-1 text-xs text-status-error">
          <AlertCircle className="h-3 w-3" aria-hidden />
          {error}
        </p>
      ) : helpText ? (
        <p className="text-xs text-text-muted">{helpText}</p>
      ) : null}
    </div>
  )
}

interface ValidationState {
  isValid: boolean
  errors: ValidationError[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useFormValidation<T extends Record<string, any>>(
  data: T,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rules: Record<keyof T, Array<(value: any) => string | null>>,
): ValidationState {
  const errors: ValidationError[] = []

  Object.entries(rules).forEach(([field, fieldRules]) => {
    const value = data[field]
    for (const rule of fieldRules) {
      const message = rule(value)
      if (message) {
        errors.push({ field, message })
        break
      }
    }
  })

  return { isValid: errors.length === 0, errors }
}
