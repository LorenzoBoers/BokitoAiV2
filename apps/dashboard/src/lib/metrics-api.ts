import { metricsRoutes } from '../api/routes'
import { apiDelete, apiGet, apiPatch, apiPost } from './api'

export type MetricUnit = 'number' | 'percent' | 'currency' | 'duration' | 'count'

export interface CustomMetricRow {
  id: string
  key: string
  label: string
  description: string
  unit: MetricUnit
  target: number | null
  sort_order: number
  latest_value: number | null
  latest_at: string | null
  latest_note: string
  latest_source: 'agent' | 'user' | 'system' | null
  previous_value: number | null
  delta: number | null
  created_at: string
}

export interface MetricPointRow {
  id: string
  value: number
  note: string
  source: string
  recorded_at: string
}

export async function listCustomMetrics(): Promise<CustomMetricRow[]> {
  const res = await apiGet<{ items: CustomMetricRow[] }>(metricsRoutes.list())
  return res.items
}

export async function createCustomMetric(input: {
  label: string
  key?: string
  description?: string
  unit?: MetricUnit
  target?: number | null
}): Promise<CustomMetricRow> {
  return apiPost<CustomMetricRow>(metricsRoutes.list(), input)
}

export async function updateCustomMetric(
  metricId: string,
  patch: {
    label?: string
    description?: string
    unit?: MetricUnit
    target?: number | null
    sort_order?: number
  },
): Promise<CustomMetricRow> {
  return apiPatch<CustomMetricRow>(metricsRoutes.metric(metricId), patch)
}

export async function deleteCustomMetric(metricId: string): Promise<void> {
  await apiDelete(metricsRoutes.metric(metricId))
}

export async function addMetricPoint(
  metricId: string,
  input: { value: number; note?: string },
): Promise<CustomMetricRow> {
  return apiPost<CustomMetricRow>(metricsRoutes.points(metricId), input)
}

export async function listMetricPoints(metricId: string): Promise<MetricPointRow[]> {
  const res = await apiGet<{ items: MetricPointRow[] }>(metricsRoutes.points(metricId))
  return res.items
}

/** Compact display formatting per unit kind. */
export function formatMetricValue(value: number | null, unit: MetricUnit): string {
  if (value === null || Number.isNaN(value)) return '--'
  switch (unit) {
    case 'percent':
      return `${trimNumber(value)}%`
    case 'currency':
      return `\u20AC${trimNumber(value)}`
    case 'duration':
      return formatDuration(value)
    default:
      return trimNumber(value)
  }
}

function trimNumber(value: number): string {
  if (Math.abs(value) >= 10000) {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)
  }
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value)
}

/** Value is minutes; render as h/m for readability. */
function formatDuration(minutes: number): string {
  if (Math.abs(minutes) >= 60) {
    const hours = Math.floor(Math.abs(minutes) / 60)
    const rest = Math.round(Math.abs(minutes) % 60)
    const sign = minutes < 0 ? '-' : ''
    return rest > 0 ? `${sign}${hours}h ${rest}m` : `${sign}${hours}h`
  }
  return `${trimNumber(minutes)}m`
}
