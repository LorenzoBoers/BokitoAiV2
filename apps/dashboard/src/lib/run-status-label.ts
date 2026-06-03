import type { TFunction } from 'i18next'
import { humanizeSnakeCase } from './display-name'

export function runStatusLabel(status: string, t: TFunction): string {
  const key = `workforce.runs.status.${status}`
  const translated = t(key, { defaultValue: '' })
  if (translated) return translated
  return humanizeSnakeCase(status)
}
