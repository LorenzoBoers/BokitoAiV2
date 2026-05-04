import React, { createContext, useContext, useState, useCallback } from 'react';
import type { ValidationError } from '../types/custom-db';

interface ValidationContextValue {
  errors: ValidationError[];
  hasErrors: boolean;
  addError: (field: string, message: string) => void;
  removeError: (field: string) => void;
  clearErrors: () => void;
  getFieldError: (field: string) => string | undefined;
  validateField: (field: string, value: any, rules: ValidationRule[]) => boolean;
}

interface ValidationRule {
  type: 'required' | 'minLength' | 'maxLength' | 'email' | 'url' | 'phone' | 'number' | 'custom';
  value?: any;
  message: string;
  validator?: (value: any) => boolean;
}

const ValidationContext = createContext<ValidationContextValue | null>(null);

export function ValidationProvider({ children }: { children: React.ReactNode }) {
  const [errors, setErrors] = useState<ValidationError[]>([]);

  const addError = useCallback((field: string, message: string) => {
    setErrors(prev => {
      const filtered = prev.filter(e => e.field !== field);
      return [...filtered, { field, message }];
    });
  }, []);

  const removeError = useCallback((field: string) => {
    setErrors(prev => prev.filter(e => e.field !== field));
  }, []);

  const clearErrors = useCallback(() => {
    setErrors([]);
  }, []);

  const getFieldError = useCallback((field: string) => {
    return errors.find(e => e.field === field)?.message;
  }, [errors]);

  const validateField = useCallback((field: string, value: any, rules: ValidationRule[]): boolean => {
    for (const rule of rules) {
      if (!validateRule(value, rule)) {
        addError(field, rule.message);
        return false;
      }
    }
    removeError(field);
    return true;
  }, [addError, removeError]);

  const value: ValidationContextValue = {
    errors,
    hasErrors: errors.length > 0,
    addError,
    removeError,
    clearErrors,
    getFieldError,
    validateField,
  };

  return <ValidationContext.Provider value={value}>{children}</ValidationContext.Provider>;
}

export function useValidation() {
  const context = useContext(ValidationContext);
  if (!context) {
    throw new Error('useValidation must be used within ValidationProvider');
  }
  return context;
}

function validateRule(value: any, rule: ValidationRule): boolean {
  switch (rule.type) {
    case 'required':
      return value !== null && value !== undefined && value !== '';
    
    case 'minLength':
      return typeof value === 'string' && value.length >= rule.value;
    
    case 'maxLength':
      return typeof value === 'string' && value.length <= rule.value;
    
    case 'email':
      return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    
    case 'url':
      try {
        new URL(value);
        return true;
      } catch {
        return false;
      }
    
    case 'phone':
      return typeof value === 'string' && /^[\+]?[0-9\s\-\(\)]{10,}$/.test(value);
    
    case 'number':
      return !isNaN(Number(value)) && isFinite(Number(value));
    
    case 'custom':
      return rule.validator ? rule.validator(value) : true;
    
    default:
      return true;
  }
}