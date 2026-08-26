import type { TFunction } from 'i18next'
import { translateDecisionText } from './activity-labels'

/** Normalize backend run titles for display in the in-app language. */
export function formatWorkLogSubject(
  subject: string | null | undefined,
  t: TFunction,
  fallback: string,
): string {
  const trimmed = subject?.trim()
  if (!trimmed) return fallback
  const translated = translateDecisionText(trimmed, t)
  return translated || fallback
}
