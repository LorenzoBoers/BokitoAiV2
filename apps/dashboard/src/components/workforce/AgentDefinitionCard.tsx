import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Card } from '../ui/card'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import {
  getAgentDefinition,
  saveAgentDefinition,
  type AgentDefinition,
  type CapabilityMode,
  type Effort,
  type McpInheritanceMode,
  type PromptMode,
} from '../../lib/agent-definition-api'

const splitList = (text: string) =>
  text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)

const joinList = (items: string[] | undefined) => (items ?? []).join(', ')

/** Denylist, capability, prompt mode, thinking effort, skills, completion requirement and MCP inheritance. */
export function AgentDefinitionCard({ agentId, canEdit }: { agentId: string; canEdit: boolean }) {
  const { t } = useTranslation('nav')
  const [definition, setDefinition] = useState<AgentDefinition | null>(null)
  const [disallowed, setDisallowed] = useState('')
  const [skills, setSkills] = useState('')
  const [completion, setCompletion] = useState('')
  const [servers, setServers] = useState('')
  const [saving, setSaving] = useState(false)

  const apply = (next: AgentDefinition) => {
    setDefinition(next)
    setDisallowed(joinList(next.disallowed_tools))
    setSkills(joinList(next.skills))
    setCompletion(joinList(next.completion_requirement?.any_of))
    setServers(joinList(next.mcp_inheritance?.servers))
  }

  useEffect(() => {
    getAgentDefinition(agentId)
      .then(apply)
      .catch(() => setDefinition(null))
  }, [agentId])

  if (!definition) return null

  const save = async () => {
    setSaving(true)
    try {
      apply(
        await saveAgentDefinition(agentId, {
          capability_mode: definition.capability_mode,
          prompt_mode: definition.prompt_mode,
          effort: definition.effort,
          disallowed_tools: splitList(disallowed),
          skills: splitList(skills),
          completion_requirement: {
            any_of: splitList(completion),
            reminder: definition.completion_requirement?.reminder ?? '',
          },
          mcp_inheritance: { mode: definition.mcp_inheritance.mode, servers: splitList(servers) },
        }),
      )
      toast.success(t('workforce.agents.definition.saved'))
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('workforce.agents.definition.error')))
    } finally {
      setSaving(false)
    }
  }

  const mcpMode = definition.mcp_inheritance.mode
  const disabled = !canEdit || saving

  return (
    <Card className="space-y-3 px-4 py-3">
      <div>
        <h3 className="text-base font-semibold text-text-heading">{t('workforce.agents.definition.title')}</h3>
        <p className="mt-1 text-sm text-text-muted">{t('workforce.agents.definition.hint')}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>{t('workforce.agents.definition.capability')}</Label>
          <Select
            value={definition.capability_mode}
            onValueChange={(value) => setDefinition({ ...definition, capability_mode: value as CapabilityMode })}
            disabled={disabled}
          >
            <SelectTrigger className="h-8 text-xs" aria-label={t('workforce.agents.definition.capability')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('workforce.agents.definition.capabilityAll')}</SelectItem>
              <SelectItem value="read-write">{t('workforce.agents.definition.capabilityReadWrite')}</SelectItem>
              <SelectItem value="read-only">{t('workforce.agents.definition.capabilityReadOnly')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>{t('workforce.agents.definition.promptMode')}</Label>
          <Select
            value={definition.prompt_mode}
            onValueChange={(value) => setDefinition({ ...definition, prompt_mode: value as PromptMode })}
            disabled={disabled}
          >
            <SelectTrigger className="h-8 text-xs" aria-label={t('workforce.agents.definition.promptMode')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="extend">{t('workforce.agents.definition.promptExtend')}</SelectItem>
              <SelectItem value="full">{t('workforce.agents.definition.promptFull')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>{t('workforce.agents.definition.effort')}</Label>
          <Select
            value={definition.effort}
            onValueChange={(value) => setDefinition({ ...definition, effort: value as Effort })}
            disabled={disabled}
          >
            <SelectTrigger className="h-8 text-xs" aria-label={t('workforce.agents.definition.effort')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="low">{t('workforce.agents.definition.effortLow')}</SelectItem>
              <SelectItem value="medium">{t('workforce.agents.definition.effortMedium')}</SelectItem>
              <SelectItem value="high">{t('workforce.agents.definition.effortHigh')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`def-disallowed-${agentId}`}>{t('workforce.agents.definition.disallowed')}</Label>
        <Input
          id={`def-disallowed-${agentId}`}
          value={disallowed}
          onChange={(e) => setDisallowed(e.target.value)}
          placeholder={t('workforce.agents.definition.disallowedHint')}
          disabled={disabled}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`def-skills-${agentId}`}>{t('workforce.agents.definition.skills')}</Label>
        <Input
          id={`def-skills-${agentId}`}
          value={skills}
          onChange={(e) => setSkills(e.target.value)}
          placeholder={t('workforce.agents.definition.skillsHint')}
          disabled={disabled}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`def-completion-${agentId}`}>{t('workforce.agents.definition.completion')}</Label>
        <Input
          id={`def-completion-${agentId}`}
          value={completion}
          onChange={(e) => setCompletion(e.target.value)}
          placeholder={t('workforce.agents.definition.completionHint')}
          disabled={disabled}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
        <div className="space-y-1">
          <Label>{t('workforce.agents.definition.mcp')}</Label>
          <Select
            value={mcpMode}
            onValueChange={(value) =>
              setDefinition({
                ...definition,
                mcp_inheritance: { ...definition.mcp_inheritance, mode: value as McpInheritanceMode },
              })
            }
            disabled={disabled}
          >
            <SelectTrigger className="h-8 text-xs" aria-label={t('workforce.agents.definition.mcp')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('workforce.agents.definition.mcpAll')}</SelectItem>
              <SelectItem value="none">{t('workforce.agents.definition.mcpNone')}</SelectItem>
              <SelectItem value="named">{t('workforce.agents.definition.mcpNamed')}</SelectItem>
              <SelectItem value="except">{t('workforce.agents.definition.mcpExcept')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {mcpMode === 'named' || mcpMode === 'except' ? (
          <div className="space-y-1">
            <Label htmlFor={`def-mcp-${agentId}`}>{t('workforce.agents.definition.mcpServers')}</Label>
            <Input
              id={`def-mcp-${agentId}`}
              value={servers}
              onChange={(e) => setServers(e.target.value)}
              disabled={disabled}
            />
          </div>
        ) : null}
      </div>
      {canEdit ? (
        <div className="flex justify-end">
          <Button type="button" size="sm" onClick={() => void save()} disabled={saving}>
            {t('workforce.agents.definition.save')}
          </Button>
        </div>
      ) : null}
    </Card>
  )
}
