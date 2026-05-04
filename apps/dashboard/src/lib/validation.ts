import type { CustomField } from '../types/custom-db';

export interface ValidationError {
  field: string;
  message: string;
  type: 'required' | 'invalid' | 'min' | 'max' | 'pattern';
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
}

export function validateFieldValue(
  field: CustomField,
  value: unknown
): ValidationResult {
  const errors: ValidationError[] = [];

  // Check required fields
  if (field.required && (value === null || value === undefined || value === '')) {
    errors.push({
      field: field.slug,
      message: `${field.name} is verplicht`,
      type: 'required',
    });
    return { isValid: false, errors };
  }

  // Skip validation for empty optional fields
  if (!field.required && (value === null || value === undefined || value === '')) {
    return { isValid: true, errors: [] };
  }

  // Type-specific validation
  switch (field.field_type) {
    case 'email':
      if (typeof value === 'string' && value) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(value)) {
          errors.push({
            field: field.slug,
            message: 'Voer een geldig e-mailadres in',
            type: 'invalid',
          });
        }
      }
      break;

    case 'url':
      if (typeof value === 'string' && value) {
        try {
          new URL(value);
        } catch {
          errors.push({
            field: field.slug,
            message: 'Voer een geldige URL in',
            type: 'invalid',
          });
        }
      }
      break;

    case 'phone':
      if (typeof value === 'string' && value) {
        const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/;
        if (!phoneRegex.test(value.replace(/[\s\-\(\)]/g, ''))) {
          errors.push({
            field: field.slug,
            message: 'Voer een geldig telefoonnummer in',
            type: 'invalid',
          });
        }
      }
      break;

    case 'number':
    case 'currency':
      if (value !== null && value !== undefined && value !== '') {
        const numValue = Number(value);
        if (isNaN(numValue)) {
          errors.push({
            field: field.slug,
            message: 'Voer een geldig nummer in',
            type: 'invalid',
          });
        } else {
          if (field.config?.min !== undefined && numValue < field.config.min) {
            errors.push({
              field: field.slug,
              message: `Waarde moet minimaal ${field.config.min} zijn`,
              type: 'min',
            });
          }
          if (field.config?.max !== undefined && numValue > field.config.max) {
            errors.push({
              field: field.slug,
              message: `Waarde mag maximaal ${field.config.max} zijn`,
              type: 'max',
            });
          }
        }
      }
      break;

    case 'text':
      if (typeof value === 'string' && field.config?.maxLength) {
        if (value.length > field.config.maxLength) {
          errors.push({
            field: field.slug,
            message: `Tekst mag maximaal ${field.config.maxLength} karakters bevatten`,
            type: 'max',
          });
        }
      }
      break;

    case 'date':
      if (typeof value === 'string' && value) {
        const date = new Date(value);
        if (isNaN(date.getTime())) {
          errors.push({
            field: field.slug,
            message: 'Voer een geldige datum in',
            type: 'invalid',
          });
        }
      }
      break;

    case 'select':
      if (field.config?.options && typeof value === 'string' && value) {
        const validOptions = field.config.options.map(opt => opt.value);
        if (!validOptions.includes(value)) {
          errors.push({
            field: field.slug,
            message: 'Selecteer een geldige optie',
            type: 'invalid',
          });
        }
      }
      break;

    case 'multi_select':
      if (field.config?.options && Array.isArray(value)) {
        const validOptions = field.config.options.map(opt => opt.value);
        const invalidValues = value.filter(v => !validOptions.includes(v));
        if (invalidValues.length > 0) {
          errors.push({
            field: field.slug,
            message: 'Een of meer geselecteerde opties zijn ongeldig',
            type: 'invalid',
          });
        }
      }
      break;

    case 'rating':
      if (value !== null && value !== undefined) {
        const numValue = Number(value);
        if (isNaN(numValue) || numValue < 1 || numValue > 5) {
          errors.push({
            field: field.slug,
            message: 'Beoordeling moet tussen 1 en 5 zijn',
            type: 'invalid',
          });
        }
      }
      break;
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

export function validateRecord(
  fields: CustomField[],
  data: Record<string, unknown>
): ValidationResult {
  const allErrors: ValidationError[] = [];

  for (const field of fields) {
    const value = data[field.slug];
    const result = validateFieldValue(field, value);
    allErrors.push(...result.errors);
  }

  return {
    isValid: allErrors.length === 0,
    errors: allErrors,
  };
}

export function validateTableName(name: string): ValidationResult {
  const errors: ValidationError[] = [];

  if (!name || name.trim().length === 0) {
    errors.push({
      field: 'name',
      message: 'Tabelnaam is verplicht',
      type: 'required',
    });
  } else if (name.length > 50) {
    errors.push({
      field: 'name',
      message: 'Tabelnaam mag maximaal 50 karakters bevatten',
      type: 'max',
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

export function validateFieldName(name: string): ValidationResult {
  const errors: ValidationError[] = [];

  if (!name || name.trim().length === 0) {
    errors.push({
      field: 'name',
      message: 'Veldnaam is verplicht',
      type: 'required',
    });
  } else if (name.length > 30) {
    errors.push({
      field: 'name',
      message: 'Veldnaam mag maximaal 30 karakters bevatten',
      type: 'max',
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}