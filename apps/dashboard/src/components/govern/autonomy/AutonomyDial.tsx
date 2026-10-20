import { useTranslation } from 'react-i18next'
import { ShieldAlert } from 'lucide-react'
import { Badge } from '../../ui/badge'
import { Card } from '../../ui/card'
import { OptionCard, OptionCardGrid } from '../../ui/option-card'
import { HandlingCardsSkeleton } from '../../ui/skeleton'
import { AiHandlingIcon } from '../../ai/AiHandlingIcon'
import type { AiHandlingMode } from '../../../lib/ai-handling'
import type { AiHandlingOverview } from '../../../lib/ai-handling-api'

export const DIAL_ORDER: AiHandlingMode[] = ['manual', 'assisted', 'autonomous']

/** The one Autonomy dial: the workspace ceiling every channel, agent and flow stays under. */
export function AutonomyDial({
  overview,
  error,
  saving,
  onChange,
}: {
  overview: AiHandlingOverview | null
  error: string | null
  saving: boolean
  onChange: (mode: AiHandlingMode) => void
}) {
  const { t } = useTranslation('govern')
  const { t: tc } = useTranslation('common')
  const privacy = overview?.clampedBy === 'privacy'
  const locked = !overview || !overview.canRaise || privacy || saving

  return (
    <Card className="space-y-4 p-5" data-testid="autonomy-dial">
      <div>
        <h2 className="text-base font-medium text-text-heading">{t('dial.title')}</h2>
        <p className="mt-0.5 text-xs text-text-muted">{t('dial.intro')}</p>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {!overview ? (
        <HandlingCardsSkeleton />
      ) : (
        <>
          <OptionCardGrid columns={3}>
            {DIAL_ORDER.map((mode) => {
              const active = overview.ceiling === mode
              return (
                <OptionCard
                  key={mode}
                  selected={active}
                  disabled={locked}
                  title={tc(`aiHandling.modes.${mode}.label`)}
                  description={tc(`aiHandling.modes.${mode}.description`)}
                  icon={<AiHandlingIcon mode={mode} size={16} />}
                  badge={
                    active ? (
                      <Badge variant="accent" size="sm">
                        {t('posture.current')}
                      </Badge>
                    ) : null
                  }
                  onClick={() => onChange(mode)}
                  data-testid={`autonomy-dial-${mode}`}
                />
              )
            })}
          </OptionCardGrid>
          {privacy ? (
            <p className="flex items-start gap-1.5 text-xs text-status-warning">
              <ShieldAlert size={12} className="mt-0.5 shrink-0" />
              {tc('aiHandling.clamped.privacy')}
            </p>
          ) : !overview.canRaise ? (
            <p className="text-xs text-text-muted">{t('dial.adminOnly')}</p>
          ) : null}
        </>
      )}
    </Card>
  )
}
