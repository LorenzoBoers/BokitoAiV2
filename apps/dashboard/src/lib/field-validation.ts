import type { CustomField, ValidationError } from '../types/custom-db'

export function validateFieldValue(field: CustomField, value: unknown): ValidationError[] {
  const errors: ValidationError[] = []
  
  // Required field validation
  if (field.required && (value === null || value === undefined || value === '')) {
    errors.push({
      field: field.slug,
      message: `${field.name} is verplicht`,
      code: 'REQUIRED'
    })
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
    errors.push({
      field: field.slug,
      message: `${field.name} mag maximaal ${maxLength} karakters bevatten`,
      code: 'MAX_LENGTH'
    })
  }
  
  if (regex) {
    try {
      const regexPattern = new RegExp(regex)
      if (!regexPattern.test(value)) {
        errors.push({
          field: field.slug,
          message: regexMessage || `${field.name} heeft een ongeldige indeling`,
          code: 'REGEX_MISMATCH'
        })
      }
    } catch (e) {
      // Invalid regex pattern - skip validation
    }
  }
  
  // Note: Unique validation would need to be done server-side with database access
  
  return errors
}

function validateNumberField(field: CustomField, value: unknown): ValidationError[] {
  const errors: ValidationError[] = []
  const { min, max, isInteger, decimals } = field.config
  
  const num = Number(value)
  if (isNaN(num)) {
    errors.push({
      field: field.slug,
      message: `${field.name} moet een geldig getal zijn`,
      code: 'INVALID_NUMBER'
    })
    return errors
  }
  
  if (isInteger && !Number.isInteger(num)) {
    errors.push({
      field: field.slug,
      message: `${field.name} moet een geheel getal zijn`,
      code: 'NOT_INTEGER'
    })
  }
  
  if (min !== undefined && num < min) {
    errors.push({
      field: field.slug,
      message: `${field.name} moet minimaal ${min} zijn`,
      code: 'MIN_VALUE'
    })
  }
  
  if (max !== undefined && num > max) {
    errors.push({
      field: field.slug,
      message: `${field.name} mag maximaal ${max} zijn`,
      code: 'MAX_VALUE'
    })
  }
  
  if (decimals !== undefined && !isInteger) {
    const decimalPlaces = (num.toString().split('.')[1] || '').length
    if (decimalPlaces > decimals) {
      errors.push({
        field: field.slug,
        message: `${field.name} mag maximaal ${decimals} decimalen hebben`,
        code: 'TOO_MANY_DECIMALS'
      })
    }
  }
  
  return errors
}

function validateEmailField(field: CustomField, value: string): ValidationError[] {
  const errors: ValidationError[] = []
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  
  if (!emailRegex.test(value)) {
    errors.push({
      field: field.slug,
      message: `${field.name} moet een geldig e-mailadres zijn`,
      code: 'INVALID_EMAIL'
    })
  }
  
  return errors
}

function validateUrlField(field: CustomField, value: string): ValidationError[] {
  const errors: ValidationError[] = []
  
  try {
    new URL(value)
  } catch {
    errors.push({
      field: field.slug,
      message: `${field.name} moet een geldige URL zijn`,
      code: 'INVALID_URL'
    })
  }
  
  return errors
}

function validatePhoneField(field: CustomField, value: string): ValidationError[] {
  const errors: ValidationError[] = []
  // Basic phone validation - could be enhanced with more specific patterns
  const phoneRegex = /^[\+]?[0-9\s\-\(\)]{7,}$/
  
  if (!phoneRegex.test(value)) {
    errors.push({
      field: field.slug,
      message: `${field.name} moet een geldig telefoonnummer zijn`,
      code: 'INVALID_PHONE'
    })
  }
  
  return errors
}

function validateDateField(field: CustomField, value: unknown): ValidationError[] {
  const errors: ValidationError[] = []
  
  const date = new Date(String(value))
  if (isNaN(date.getTime())) {
    errors.push({
      field: field.slug,
      message: `${field.name} moet een geldige datum zijn`,
      code: 'INVALID_DATE'
    })
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
    errors.push({
      field: field.slug,
      message: `${field.name} moet een geheel getal zijn`,
      code: 'INVALID_RATING'
    })
    return errors
  }
  
  if (num < 0 || num > max) {
    errors.push({
      field: field.slug,
      message: `${field.name} moet tussen 0 en ${max} zijn`,
      code: 'RATING_OUT_OF_RANGE'
    })
  }
  
  return errors
}

function validateSelectField(field: CustomField, value: unknown): ValidationError[] {
  const errors: ValidationError[] = []
  const { options = [] } = field.config
  
  const validValues = options.map(opt => opt.value)
  if (!validValues.includes(String(value))) {
    errors.push({
      field: field.slug,
      message: `${field.name} heeft een ongeldige waarde`,
      code: 'INVALID_OPTION'
    })
  }
  
  return errors
}

function validateMultiSelectField(field: CustomField, value: unknown): ValidationError[] {
  const errors: ValidationError[] = []
  const { options = [] } = field.config
  
  if (!Array.isArray(value)) {
    errors.push({
      field: field.slug,
      message: `${field.name} moet een lijst van waarden zijn`,
      code: 'INVALID_MULTI_SELECT'
    })
    return errors
  }
  
  const validValues = options.map(opt => opt.value)
  const invalidValues = value.filter(v => !validValues.includes(String(v)))
  
  if (invalidValues.length > 0) {
    errors.push({
      field: field.slug,
      message: `${field.name} bevat ongeldige waarden: ${invalidValues.join(', ')}`,
      code: 'INVALID_MULTI_SELECT_OPTIONS'
    })
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
  if (!field.default_value) return undefined
  
  const { type, value } = field.default_value
  
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