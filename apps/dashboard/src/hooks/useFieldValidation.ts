import { useState, useCallback } from 'react'
import type { CustomField, ValidationError } from '../types/custom-db'
import { validateFieldValue, validateRecord } from '../lib/field-validation'

export function useFieldValidation() {
  const [errors, setErrors] = useState<Record<string, ValidationError[]>>({})

  const validateField = useCallback((field: CustomField, value: unknown): ValidationError[] => {
    const fieldErrors = validateFieldValue(field, value)
    
    setErrors(prev => ({
      ...prev,
      [field.slug]: fieldErrors
    }))
    
    return fieldErrors
  }, [])

  const validateAllFields = useCallback((fields: CustomField[], data: Record<string, unknown>): ValidationError[] => {
    const allErrors = validateRecord(fields, data)
    
    // Group errors by field
    const errorsByField: Record<string, ValidationError[]> = {}
    for (const error of allErrors) {
      if (!errorsByField[error.field]) {
        errorsByField[error.field] = []
      }
      errorsByField[error.field].push(error)
    }
    
    setErrors(errorsByField)
    return allErrors
  }, [])

  const clearFieldErrors = useCallback((fieldSlug: string) => {
    setErrors(prev => {
      const next = { ...prev }
      delete next[fieldSlug]
      return next
    })
  }, [])

  const clearAllErrors = useCallback(() => {
    setErrors({})
  }, [])

  const getFieldErrors = useCallback((fieldSlug: string): ValidationError[] => {
    return errors[fieldSlug] || []
  }, [errors])

  const hasErrors = Object.values(errors).some(fieldErrors => fieldErrors.length > 0)
  const hasFieldError = useCallback((fieldSlug: string): boolean => {
    return (errors[fieldSlug] || []).length > 0
  }, [errors])

  return {
    errors,
    validateField,
    validateAllFields,
    clearFieldErrors,
    clearAllErrors,
    getFieldErrors,
    hasErrors,
    hasFieldError,
  }
}