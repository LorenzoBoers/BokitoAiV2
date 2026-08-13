import { } from 'react';
import { AlertCircle, CheckCircle } from 'lucide-react';
import { cn } from '../../lib/utils';

interface ValidationError {
  field: string;
  message: string;
}

interface FormValidationProps {
  errors: ValidationError[];
  className?: string;
}

export function FormValidation({ errors, className }: FormValidationProps) {
  if (errors.length === 0) return null;

  return (
    <div className={cn(
      'p-4 bg-status-error/10 border border-status-error/30 rounded-lg',
      className
    )}>
      <div className="flex items-start gap-2">
        <AlertCircle className="w-5 h-5 text-status-error flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <h4 className="text-sm font-medium text-status-error mb-2">
            Please correct the following errors:
          </h4>
          <ul className="space-y-1">
            {errors.map((error, index) => (
              <li key={index} className="text-sm text-status-error">
                <strong>{error.field}:</strong> {error.message}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

interface ValidatedInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  success?: boolean;
  helpText?: string;
  required?: boolean;
}

export function ValidatedInput({
  label,
  error,
  success,
  helpText,
  required,
  className,
  ...props
}: ValidatedInputProps) {
  const hasError = !!error;
  const hasSuccess = success && !hasError;

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-text-secondary">
        {label}
        {required && <span className="text-status-error ml-1">*</span>}
      </label>
      
      <div className="relative">
        <input
          className={cn(
            'w-full px-4 py-2.5 rounded-md border text-text-primary placeholder-text-muted text-sm transition',
            'focus:outline-none focus:ring-2 focus:ring-offset-0',
            hasError
              ? 'border-status-error bg-status-error/5 focus:border-status-error focus:ring-status-error/20'
              : hasSuccess
              ? 'border-status-success bg-status-success/5 focus:border-status-success focus:ring-status-success/20'
              : 'border-border bg-bg-input focus:border-border-focus focus:ring-accent/20',
            className
          )}
          {...props}
        />
        
        {(hasError || hasSuccess) && (
          <div className="absolute inset-y-0 right-0 flex items-center pr-3">
            {hasError && <AlertCircle className="w-4 h-4 text-status-error" />}
            {hasSuccess && <CheckCircle className="w-4 h-4 text-status-success" />}
          </div>
        )}
      </div>
      
      {(error || helpText) && (
        <div className="space-y-1">
          {error && (
            <p className="text-sm text-status-error flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              {error}
            </p>
          )}
          {helpText && !error && (
            <p className="text-xs text-text-muted">{helpText}</p>
          )}
        </div>
      )}
    </div>
  );
}

interface ValidatedSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string;
  success?: boolean;
  helpText?: string;
  required?: boolean;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  placeholder?: string;
}

export function ValidatedSelect({
  label,
  error,
  success,
  helpText,
  required,
  options,
  placeholder,
  className,
  ...props
}: ValidatedSelectProps) {
  const hasError = !!error;
  const hasSuccess = success && !hasError;

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-text-secondary">
        {label}
        {required && <span className="text-status-error ml-1">*</span>}
      </label>
      
      <div className="relative">
        <select
          className={cn(
            'w-full px-4 py-2.5 rounded-md border text-text-primary text-sm transition',
            'focus:outline-none focus:ring-2 focus:ring-offset-0',
            hasError
              ? 'border-status-error bg-status-error/5 focus:border-status-error focus:ring-status-error/20'
              : hasSuccess
              ? 'border-status-success bg-status-success/5 focus:border-status-success focus:ring-status-success/20'
              : 'border-border bg-bg-input focus:border-border-focus focus:ring-accent/20',
            className
          )}
          {...props}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((option) => (
            <option
              key={option.value}
              value={option.value}
              disabled={option.disabled}
            >
              {option.label}
            </option>
          ))}
        </select>
        
        {(hasError || hasSuccess) && (
          <div className="absolute inset-y-0 right-8 flex items-center pr-3">
            {hasError && <AlertCircle className="w-4 h-4 text-status-error" />}
            {hasSuccess && <CheckCircle className="w-4 h-4 text-status-success" />}
          </div>
        )}
      </div>
      
      {(error || helpText) && (
        <div className="space-y-1">
          {error && (
            <p className="text-sm text-status-error flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              {error}
            </p>
          )}
          {helpText && !error && (
            <p className="text-xs text-text-muted">{helpText}</p>
          )}
        </div>
      )}
    </div>
  );
}

interface ValidationState {
  isValid: boolean;
  errors: ValidationError[];
}

export function useFormValidation<T extends Record<string, any>>(
  data: T,
  rules: Record<keyof T, Array<(value: any) => string | null>>
): ValidationState {
  const errors: ValidationError[] = [];

  Object.entries(rules).forEach(([field, fieldRules]) => {
    const value = data[field];
    
    for (const rule of fieldRules) {
      const error = rule(value);
      if (error) {
        errors.push({ field, message: error });
        break; // Only show first error per field
      }
    }
  });

  return {
    isValid: errors.length === 0,
    errors,
  };
}

// Common validation rules
export const ValidationRules = {
  required: (fieldName: string) => (value: any) => {
    if (value === null || value === undefined || value === '') {
      return `${fieldName} is required`;
    }
    return null;
  },

  minLength: (min: number, fieldName: string) => (value: string) => {
    if (value && value.length < min) {
      return `${fieldName} must be at least ${min} characters`;
    }
    return null;
  },

  maxLength: (max: number, fieldName: string) => (value: string) => {
    if (value && value.length > max) {
      return `${fieldName} must be at most ${max} characters`;
    }
    return null;
  },

  email: (fieldName: string) => (value: string) => {
    if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return `${fieldName} must be a valid email address`;
    }
    return null;
  },

  url: (fieldName: string) => (value: string) => {
    if (value) {
      try {
        new URL(value);
      } catch {
        return `${fieldName} must be a valid URL`;
      }
    }
    return null;
  },

  number: (fieldName: string) => (value: any) => {
    if (value !== null && value !== undefined && value !== '' && isNaN(Number(value))) {
      return `${fieldName} must be a valid number`;
    }
    return null;
  },

  min: (min: number, fieldName: string) => (value: number) => {
    if (value !== null && value !== undefined && value < min) {
      return `${fieldName} must be at least ${min}`;
    }
    return null;
  },

  max: (max: number, fieldName: string) => (value: number) => {
    if (value !== null && value !== undefined && value > max) {
      return `${fieldName} must be at most ${max}`;
    }
    return null;
  },

  pattern: (regex: RegExp, message: string) => (value: string) => {
    if (value && !regex.test(value)) {
      return message;
    }
    return null;
  },
};