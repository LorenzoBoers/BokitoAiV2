import type { CustomField, ValidationError } from '../types/custom-db'

function err(
  field: CustomField,
  message: string,
  type: ValidationError['type'],
): ValidationError {
  return { fieldSlug: field.slug, message, type }
}

export function validateFieldValue(field: CustomField, value: unknown): ValidationError[] {
  const errors: ValidationError[] = []
  
  // Required field validation
  if (field.required && (value === null || value === undefined || value === '')) {
    errors.push(err(field, `${field.name} is verplicht`, 'required'))
    return errors // Don't validate further if required field is empty
  }

  // Skip validation if value is empty and not required
  if (value === null || value === undefined || value === '') {
    return errors
  }

  switch (field.field_type) {
    case 'text':
    case 'long_text':
      return validateTextField(field, String(value))
    
    case 'number':
      return validateNumberField(field, value)
    
    case 'email':
      return validateEmailField(field, String(value))
    
    case 'url':
      return validateUrlField(field, String(value))
    
    case 'phone':
      return validatePhoneField(field, String(value))
    
    case 'date':
      return validateDateField(field, value)
    
    case 'currency':
      return validateCurrencyField(field, value)
    
    case 'rating':
      return validateRatingField(field, value)
    
    case 'select':
      return validateSelectField(field, value)
    
    case 'multi_select':
      return validateMultiSelectField(field, value)
    
    default:
      return errors
  }
}

function validateTextField(field: CustomField, value: string): ValidationError[] {
  const errors: ValidationError[] = []
  const { maxLength, regex, regexMessage } = field.config

  if (maxLength && value.length > maxLength) {
    errors.push(err(field, `${field.name} mag maximaal ${maxLength} karakters bevatten`, 'range'))
  }

  if (regex) {
    try {
      const regexPattern = new RegExp(regex)
      if (!regexPattern.test(value)) {
        errors.push(
          err(field, regexMessage || `${field.name} heeft een ongeldige indeling`, 'format'),
        )
      }
    } catch {
      // Invalid regex pattern - skip validation
    }
  }

  return errors
}

function validateNumberField(field: CustomField, value: unknown): ValidationError[] {
  const errors: ValidationError[] = []
  const { min, max, isInteger, decimals } = field.config

  const num = Number(value)
  if (isNaN(num)) {
    errors.push(err(field, `${field.name} moet een geldig getal zijn`, 'format'))
    return errors
  }

  if (isInteger && !Number.isInteger(num)) {
    errors.push(err(field, `${field.name} moet een geheel getal zijn`, 'format'))
  }

  if (min !== undefined && num < min) {
    errors.push(err(field, `${field.name} moet minimaal ${min} zijn`, 'range'))
  }

  if (max !== undefined && num > max) {
    errors.push(err(field, `${field.name} mag maximaal ${max} zijn`, 'range'))
  }

  if (decimals !== undefined && !isInteger) {
    const decimalPlaces = (num.toString().split('.')[1] || '').length
    if (decimalPlaces > decimals) {
      errors.push(err(field, `${field.name} mag maximaal ${decimals} decimalen hebben`, 'range'))
    }
  }

  return errors
}

function validateEmailField(field: CustomField, value: string): ValidationError[] {
  const errors: ValidationError[] = []
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

  if (!emailRegex.test(value)) {
    errors.push(err(field, `${field.name} moet een geldig e-mailadres zijn`, 'format'))
  }

  return errors
}

function validateUrlField(field: CustomField, value: string): ValidationError[] {
  const errors: ValidationError[] = []

  try {
    new URL(value)
  } catch {
    errors.push(err(field, `${field.name} moet een geldige URL zijn`, 'format'))
  }

  return errors
}

function validatePhoneField(field: CustomField, value: string): ValidationError[] {
  const errors: ValidationError[] = []
  const phoneRegex = /^[\+]?[0-9\s\-\(\)]{7,}$/

  if (!phoneRegex.test(value)) {
    errors.push(err(field, `${field.name} moet een geldig telefoonnummer zijn`, 'format'))
  }

  return errors
}

function validateDateField(field: CustomField, value: unknown): ValidationError[] {
  const errors: ValidationError[] = []

  const date = new Date(String(value))
  if (isNaN(date.getTime())) {
    errors.push(err(field, `${field.name} moet een geldige datum zijn`, 'format'))
  }

  return errors
}

function validateCurrencyField(field: CustomField, value: unknown): ValidationError[] {
  // Currency fields are essentially number fields with formatting
  return validateNumberField(field, value)
}

function validateRatingField(field: CustomField, value: unknown): ValidationError[] {
  const errors: ValidationError[] = []
  const { max = 5 } = field.config
  
  const num = Number(value)
  if (isNaN(num) || !Number.isInteger(num)) {
    errors.push(err(field, `${field.name} moet een geheel getal zijn`, 'format'))
    return errors
  }

  if (num < 0 || num > max) {
    errors.push(err(field, `${field.name} moet tussen 0 en ${max} zijn`, 'range'))
  }
  
  return errors
}

function validateSelectField(field: CustomField, value: unknown): ValidationError[] {
  const errors: ValidationError[] = []
  const { options = [] } = field.config
  
  const validValues = options.map(opt => opt.value)
  if (!validValues.includes(String(value))) {
    errors.push(err(field, `${field.name} heeft een ongeldige waarde`, 'format'))
  }
  
  return errors
}

function validateMultiSelectField(field: CustomField, value: unknown): ValidationError[] {
  const errors: ValidationError[] = []
  const { options = [] } = field.config
  
  if (!Array.isArray(value)) {
    errors.push(err(field, `${field.name} moet een lijst van waarden zijn`, 'format'))
    return errors
  }

  const validValues = options.map(opt => opt.value)
  const invalidValues = value.filter(v => !validValues.includes(String(v)))

  if (invalidValues.length > 0) {
    errors.push(
      err(field, `${field.name} bevat ongeldige waarden: ${invalidValues.join(', ')}`, 'format'),
    )
  }
  
  return errors
}

export function validateRecord(fields: CustomField[], data: Record<string, unknown>): ValidationError[] {
  const errors: ValidationError[] = []
  
  for (const field of fields) {
    const value = data[field.slug]
    const fieldErrors = validateFieldValue(field, value)
    errors.push(...fieldErrors)
  }
  
  return errors
}

export function applyDefaultValues(fields: CustomField[], data: Record<string, unknown>): Record<string, unknown> {
  const result = { ...data }
  
  for (const field of fields) {
    if (result[field.slug] === undefined || result[field.slug] === null || result[field.slug] === '') {
      const defaultValue = getDefaultValue(field)
      if (defaultValue !== undefined) {
        result[field.slug] = defaultValue
      }
    }
  }
  
  return result
}

function getDefaultValue(field: CustomField): unknown {
  const defaultValue = field.default_value
  if (defaultValue === null || defaultValue === undefined) return undefined
  if (typeof defaultValue !== 'object' || defaultValue === null || !('type' in defaultValue)) {
    return defaultValue
  }

  const { type, value } = defaultValue as { type: string; value: unknown }

  switch (type) {
    case 'static':
      return value
    
    case 'today':
      return new Date().toISOString().split('T')[0]
    
    case 'current_user':
      // This would need to be implemented with actual user context
      return 'current_user_id'
    
    case 'auto_increment':
      // This should be handled server-side
      return undefined
    
    default:
      return undefined
  }
}