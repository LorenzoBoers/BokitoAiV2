import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'
import type { IntegrationKindFilter } from '../../lib/integration-kind-url'

const SEGMENTS: IntegrationKindFilter[] = ['all', 'inbox', 'repository', 'calendar', 'app', 'mcp']

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
    <div
      className={cn(
        'inline-flex flex-wrap items-center gap-1 rounded-lg border border-border/60 bg-bg-elevated/40 p-1',
        className,
      )}
      role="tablist"
      aria-label={t('integrations.kindNav.label', { defaultValue: 'Integration type' })}
    >
      {SEGMENTS.map((segment) => {
        const count = counts?.[segment]
        const active = value === segment
        return (
          <button
            key={segment}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(segment)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              active
                ? 'bg-bg-surface text-text-heading shadow-sm'
                : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover/60',
            )}
          >
            <span>{t(segmentLabelKey(segment))}</span>
            {count != null && count > 0 ? (
              <span
                className={cn(
                  'min-w-[1.25rem] rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
                  active ? 'bg-bg-hover text-text-heading' : 'bg-bg-hover/80 text-text-muted',
                )}
              >
                {count}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
