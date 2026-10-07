import { useTranslation } from 'react-i18next'
import { FilterChip, FilterChipRow } from '../ui/filter-chip'
import type { IntegrationKindFilter } from '../../lib/integration-kind-url'

const SEGMENTS: IntegrationKindFilter[] = ['all', 'inbox', 'calendar', 'app', 'mcp', 'repository']

export type IntegrationKindCounts = Partial<Record<IntegrationKindFilter, number>>

type IntegrationKindNavProps = {
  value: IntegrationKindFilter
  onChange: (value: IntegrationKindFilter) => void
  counts?: IntegrationKindCounts
  className?: string
}

function segmentLabelKey(segment: IntegrationKindFilter): string {
  if (segment === 'all') return 'integrations.filters.all'
  return `integrations.filters.${segment}`
}

export function IntegrationKindNav({ value, onChange, counts, className }: IntegrationKindNavProps) {
  const { t } = useTranslation('nav')

  return (
    <FilterChipRow
      className={className}
      role="group"
      aria-label={t('integrations.kindNav.label', { defaultValue: 'Integration type' })}
    >
      {SEGMENTS.map((segment) => {
        const count = counts?.[segment]
        return (
          <FilterChip
            key={segment}
            active={value === segment}
            count={count != null && count > 0 ? count : undefined}
            onClick={() => onChange(segment)}
          >
            {t(segmentLabelKey(segment))}
          </FilterChip>
        )
      })}
    </FilterChipRow>
  )
}
