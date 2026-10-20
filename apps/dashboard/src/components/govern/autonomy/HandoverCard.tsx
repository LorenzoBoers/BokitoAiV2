import type { Dispatch, SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'
import { Card } from '../../ui/card'
import { Label } from '../../ui/label'
import { SettingsFieldsSkeleton } from '../../ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select'
import { RoutingPolicyFields } from '../../ai/RoutingPolicyFields'
import type { AiHandlingRouting } from '../../../lib/ai-handling-api'
import { SectionHeading } from './SettingRow'

export type LeadAgentOption = { id: string; name: string; isLead: boolean }

/** Who owns a conversation after a reply, and which agent answers by default. */
export function HandoverCard({
  routing,
  setRouting,
  agents,
  canEditLead,
  leadBusy,
  onLeadChange,
}: {
  routing: AiHandlingRouting | null
  setRouting: Dispatch<SetStateAction<AiHandlingRouting | null>>
  agents: LeadAgentOption[]
  canEditLead: boolean
  leadBusy: boolean
  onLeadChange: (agentId: string) => void
}) {
  const { t } = useTranslation('nav')

  return (
    <Card className="space-y-5 p-5" data-testid="ai-handling-routing">
      <SectionHeading
        title={t('ai.communication.routing.title')}
        description={t('ai.communication.routing.description')}
      />
      {agents.length > 0 ? (
        <div className="space-y-1.5">
          <Label>{t('ai.communication.defaultAgentTitle')}</Label>
          <Select
            value={agents.find((agent) => agent.isLead)?.id ?? ''}
            disabled={!canEditLead || leadBusy}
            onValueChange={(agentId) => agentId && onLeadChange(agentId)}
          >
            <SelectTrigger className="h-9" data-testid="workspace-lead-agent">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {agents.map((agent) => (
                <SelectItem key={agent.id} value={agent.id}>
                  {agent.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-text-muted">{t('ai.communication.defaultAgentHint')}</p>
        </div>
      ) : null}
      {!routing ? (
        <SettingsFieldsSkeleton rows={4} />
      ) : (
        <div className="space-y-5">
          <RoutingPolicyFields
            value={routing}
            idPrefix="ai-routing"
            onChange={(key, next) => {
              if (next === null) return
              setRouting((prev) => (prev ? { ...prev, [key]: next } : prev))
            }}
          />
          <p className="text-xs text-text-muted">{t('ai.communication.routing.channelOverrideHint')}</p>
        </div>
      )}
    </Card>
  )
}
