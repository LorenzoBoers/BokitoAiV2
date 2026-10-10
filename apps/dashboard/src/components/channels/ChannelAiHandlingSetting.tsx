import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ShieldAlert } from 'lucide-react'
import AiHandlingPicker from '../ai/AiHandlingPicker'
import { AiHandlingIcon } from '../ai/AiHandlingIcon'
import { Badge } from '../ui/badge'
import { DropdownMenuItem } from '../ui/dropdown-menu'
import { useAiHandling } from '../../hooks/useAiHandling'
import { useAuth } from '../../context/AuthContext'
import { resetAiBreaker } from '../../lib/ai-handling-api'
import type { AiHandling } from '../../lib/ai-handling'
import type { ChannelRow } from '../../lib/channels-api'

/** AI handling for one channel, with the circuit-breaker reset in the same menu. */
export default function ChannelAiHandlingSetting({
  row,
  onChanged,
}: {
  row: ChannelRow
  onChanged: (next: AiHandling | null) => void
}) {
  const { t } = useTranslation('common')
  const { token } = useAuth()
  const { handling, setHandling, change, saving, canRaise } = useAiHandling('channel', row.id, {
    initial: row.aiHandling,
    onChanged,
  })
  const tripped = Boolean(handling?.breakerTrippedAt)

  const reset = async (keepAssisted: boolean) => {
    if (!token) return
    try {
      const next = await resetAiBreaker(token, row.id, keepAssisted)
      setHandling(next)
      onChanged(next)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('aiHandling.saveError'))
    }
  }

  return (
    <>
    <AiHandlingPicker
      variant="row"
      density="field"
      scope="channel"
      handling={handling}
      canRaise={canRaise}
      saving={saving}
      onChange={(mode) => void change(mode)}
      testId="channel-ai-handling"
      label={
        <span className="inline-flex items-center gap-2 text-sm font-medium text-text-heading">
          {t('aiHandling.title')}
          {tripped ? (
            <Badge
              variant="warning"
              className="gap-1 px-1.5 py-0 text-2xs"
              title={t('aiHandling.clamped.breaker')}
              data-testid="channel-ai-breaker"
            >
              <ShieldAlert size={10} />
              {t('aiHandling.breakerBadge')}
            </Badge>
          ) : null}
        </span>
      }
      extraItems={
        tripped && canRaise ? (
          <>
            <DropdownMenuItem className="gap-2 text-xs" onSelect={() => void reset(false)}>
              <AiHandlingIcon mode="autonomous" size={13} />
              {t('aiHandling.breakerResume')}
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2 text-xs" onSelect={() => void reset(true)}>
              <AiHandlingIcon mode="assisted" size={13} />
              {t('aiHandling.breakerKeepAssisted')}
            </DropdownMenuItem>
          </>
        ) : null
      }
    />
    {handling?.promotion && (handling.requested === 'assisted' || handling.effective === 'assisted') ? (
      <p className="px-1 pb-1 text-xs text-text-muted" data-testid="channel-autonomy-progress">
        {t('aiHandling.metrics.promotionProgress', {
          done: handling.promotion.unedited,
          target: handling.promotion.targetDrafts,
        })}
      </p>
    ) : null}
    </>
  )
}
