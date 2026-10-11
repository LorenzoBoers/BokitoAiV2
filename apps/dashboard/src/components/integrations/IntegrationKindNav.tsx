import { useTranslation } from 'react-i18next'
import { FilterChip, FilterChipRow } from '../ui/filter-chip'
import { KIND_FILTERS, type IntegrationKindFilter } from '../../lib/integration-kind-url'

export type IntegrationKindCounts = Partial<Record<IntegrationKindFilter, number>>

type IntegrationKindNavProps = {
  value: IntegrationKindFilter
  onChange: (value: IntegrationKindFilter) => void
  counts?: IntegrationKindCounts
  className?: string
}

/** Category chips for the Connections page; one row, all kinds incl. Modules and AI tools. */
export function IntegrationKindNav({ value, onChange, counts, className }: IntegrationKindNavProps) {
  const { t } = useTranslation('nav')

  return (
    <FilterChipRow
      className={className}
      role="group"
      aria-label={t('integrations.kindNav.label', { defaultValue: 'Category' })}
    >
      {KIND_FILTERS.map((segment) => {
        const count = counts?.[segment]
        return (
          <FilterChip
            key={segment}
            active={value === segment}
            count={count != null && count > 0 ? count : undefined}
            onClick={() => onChange(segment)}
          >
            {t(`integrations.filters.${segment}`)}
          </FilterChip>
        )
      })}
    </FilterChipRow>
  )
}
