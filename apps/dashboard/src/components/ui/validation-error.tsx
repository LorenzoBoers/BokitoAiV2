import { AlertCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { ValidationError } from '../../lib/validation';

interface ValidationErrorProps {
  error?: ValidationError;
  className?: string;
}

export function ValidationError({ error, className }: ValidationErrorProps) {
  if (!error) return null;

  return (
    <div className={cn('flex items-center gap-1.5 text-xs text-status-error mt-1', className)}>
      <AlertCircle size={12} />
      <span>{error.message}</span>
    </div>
  );
}

interface ValidationErrorsProps {
  errors: ValidationError[];
  className?: string;
}

export function ValidationErrors({ errors, className }: ValidationErrorsProps) {
  if (errors.length === 0) return null;

  return (
    <div className={cn('space-y-1', className)}>
      {errors.map((error, index) => (
        <ValidationError key={index} error={error} />
      ))}
    </div>
  );
}

interface ValidationSummaryProps {
  errors: ValidationError[];
  className?: string;
}

export function ValidationSummary({ errors, className }: ValidationSummaryProps) {
  if (errors.length === 0) return null;

  return (
    <div className={cn(
      'rounded-md bg-status-error/10 border border-status-error/30 p-3',
      className
    )}>
      <div className="flex items-center gap-2 text-status-error text-sm font-medium mb-2">
        <AlertCircle size={16} />
        <span>Er zijn {errors.length} fout{errors.length !== 1 ? 'en' : ''} gevonden:</span>
      </div>
      <ul className="space-y-1 text-xs text-status-error">
        {errors.map((error, index) => (
          <li key={index} className="flex items-start gap-1">
            <span>•</span>
            <span>{error.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}