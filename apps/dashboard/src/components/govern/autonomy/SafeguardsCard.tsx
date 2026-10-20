import type { Dispatch, SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'
import { Gauge, MessageSquareText, ShieldAlert, UserRoundCheck } from 'lucide-react'
import { Card } from '../../ui/card'
import { Input } from '../../ui/input'
import { Label } from '../../ui/label'
import { Switch } from '../../ui/switch'
import { SwitchRowsSkeleton } from '../../ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select'
import type {
  AiHandlingBreaker,
  AiHandlingDisclosure,
  AiHandlingRouting,
  AiHandlingSafeguards,
} from '../../../lib/ai-handling-api'
import { SectionHeading, SettingRow } from './SettingRow'

type Setter<T> = Dispatch<SetStateAction<T | null>>

/** When an autonomous reply becomes a draft: threshold, new contacts, breaker, bounce limit, disclosure. */
export function SafeguardsCard({
  safeguards,
  setSafeguards,
  breaker,
  setBreaker,
  disclosure,
  setDisclosure,
  routing,
  setRouting,
  disclosurePreview,
}: {
  safeguards: AiHandlingSafeguards | null
  setSafeguards: Setter<AiHandlingSafeguards>
  breaker: AiHandlingBreaker | null
  setBreaker: Setter<AiHandlingBreaker>
  disclosure: AiHandlingDisclosure | null
  setDisclosure: Setter<AiHandlingDisclosure>
  routing: AiHandlingRouting | null
  setRouting: Setter<AiHandlingRouting>
  disclosurePreview: string | null
}) {
  const { t } = useTranslation('nav')

  return (
    <Card className="space-y-5 p-5" data-testid="ai-handling-safeguards">
      <SectionHeading
        title={t('ai.communication.safeguardsTitle')}
        description={t('ai.communication.safeguardsDescription')}
      />
      {!safeguards || !disclosure ? (
        <SwitchRowsSkeleton rows={4} />
      ) : (
        <div className="space-y-5">
          <SettingRow
            first
            icon={Gauge}
            htmlFor="ai-certainty-threshold"
            label={t('ai.communication.certaintyLabel')}
            hint={t('ai.communication.certaintyHint')}
          >
            <Select
              value={String(safeguards.certaintyThreshold)}
              onValueChange={(v) => setSafeguards((prev) => (prev ? { ...prev, certaintyThreshold: Number(v) } : prev))}
            >
              <SelectTrigger id="ai-certainty-threshold" className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n} -{' '}
                    {n <= 3
                      ? t('ai.communication.certaintyLow')
                      : n <= 7
                        ? t('ai.communication.certaintyMedium')
                        : t('ai.communication.certaintyHigh')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>
          <SettingRow
            icon={UserRoundCheck}
            htmlFor="ai-new-contacts"
            label={t('ai.communication.newContactsLabel')}
            hint={t('ai.communication.newContactsHint')}
          >
            <Switch
              id="ai-new-contacts"
              checked={safeguards.newContacts}
              onCheckedChange={(checked) => setSafeguards((prev) => (prev ? { ...prev, newContacts: checked } : prev))}
            />
          </SettingRow>
          {routing ? (
            <SettingRow
              icon={ShieldAlert}
              htmlFor="ai-routing-bounce-limit"
              label={t('ai.communication.routing.bounceLimit.label')}
              hint={t('ai.communication.routing.bounceLimit.hint')}
            >
              <Input
                id="ai-routing-bounce-limit"
                type="number"
                min={0}
                max={20}
                className="w-24"
                value={routing.bounceLimit}
                onChange={(e) => {
                  const parsed = Number(e.target.value)
                  const next = Number.isFinite(parsed) ? Math.min(20, Math.max(0, Math.round(parsed))) : 0
                  setRouting((prev) => (prev ? { ...prev, bounceLimit: next } : prev))
                }}
              />
            </SettingRow>
          ) : null}
          <SettingRow
            icon={MessageSquareText}
            htmlFor="ai-disclosure"
            label={t('ai.communication.disclosureLabel')}
            hint={t('ai.communication.disclosureHint')}
          >
            <Switch
              id="ai-disclosure"
              checked={disclosure.enabled}
              onCheckedChange={(checked) => setDisclosure((prev) => (prev ? { ...prev, enabled: checked } : prev))}
            />
          </SettingRow>
          {disclosure.enabled ? (
            <div className="space-y-1.5 pl-7">
              <Label htmlFor="ai-disclosure-text" className="text-xs font-medium text-text-secondary">
                {t('ai.communication.disclosureTextLabel')}
              </Label>
              <Input
                id="ai-disclosure-text"
                value={disclosure.text}
                maxLength={200}
                placeholder={disclosurePreview ?? t('ai.communication.disclosurePlaceholder')}
                onChange={(e) => {
                  const text = e.target.value
                  setDisclosure((prev) => (prev ? { ...prev, text } : prev))
                }}
              />
              <p className="text-xs text-text-muted">
                {t('ai.communication.disclosurePreview', { text: disclosure.text.trim() || disclosurePreview || '' })}
              </p>
            </div>
          ) : null}

          <div className="space-y-3 border-t border-border/60 pt-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-medium text-text-heading">{t('ai.communication.breakerTitle')}</h4>
                <p className="mt-0.5 text-xs text-text-muted">{t('ai.communication.breakerHint')}</p>
              </div>
              {breaker ? (
                <Switch
                  checked={breaker.enabled}
                  onCheckedChange={(checked) => setBreaker((prev) => (prev ? { ...prev, enabled: checked } : prev))}
                  aria-label={t('ai.communication.breakerTitle')}
                />
              ) : null}
            </div>
            {breaker?.enabled ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-xs text-text-secondary">
                  <span>{t('ai.communication.maxAutonomous')}</span>
                  <Input
                    type="number"
                    min={1}
                    max={1000}
                    value={breaker.maxAutonomousPerHour}
                    onChange={(e) =>
                      setBreaker((prev) => (prev ? { ...prev, maxAutonomousPerHour: Number(e.target.value) || 1 } : prev))
                    }
                  />
                </label>
                <label className="space-y-1 text-xs text-text-secondary">
                  <span>{t('ai.communication.maxNegative')}</span>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={breaker.maxNegativePerHour}
                    onChange={(e) =>
                      setBreaker((prev) => (prev ? { ...prev, maxNegativePerHour: Number(e.target.value) || 1 } : prev))
                    }
                  />
                </label>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </Card>
  )
}
