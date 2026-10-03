import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { FlaskConical, Plus, Trash2 } from 'lucide-react'
import { Card } from '../ui/card'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import {
  getAgentRules,
  getWorkspaceRules,
  saveAgentRules,
  saveWorkspaceRules,
  testAgentRules,
  testWorkspaceRules,
  type AgentRule,
  type AutonomyMode,
  type RuleKind,
  type RuleTestOutcome,
} from '../../lib/agent-rules-api'
import { getAllowances, type GovernToolRow } from '../../lib/govern-api'
import { humanizeLabel } from '../../lib/labels'
import { toolCategoryLabel } from '../../lib/govern-labels'

const MODES: AutonomyMode[] = ['manual', 'assisted', 'autonomous']

const EMPTY_DRAFT = { text: '', mode: 'assisted' as AutonomyMode, kind: 'judgement' as RuleKind, target: '' }

/**
 * When an agent acts on its own and when it asks: the ceiling (agent page
 * only), exception rules, and Try out to see which rule decides an action.
 * Without ``agentId`` it edits the workspace rules every agent follows.
 */
export function AgentRulesEditor({
  agentId,
  canEdit,
  canGrant,
}: {
  agentId?: string
  canEdit: boolean
  /** Owners and admins may let an agent act on its own. */
  canGrant: boolean
}) {
  const { t } = useTranslation('nav')
  const { t: tGovern } = useTranslation('govern')
  const [ceiling, setCeiling] = useState<AutonomyMode>('assisted')
  const [rules, setRules] = useState<AgentRule[]>([])
  const [inherited, setInherited] = useState<AgentRule[]>([])
  const [tools, setTools] = useState<GovernToolRow[]>([])
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const [saving, setSaving] = useState(false)
  const [tryTool, setTryTool] = useState('')
  const [tryCertainty, setTryCertainty] = useState('')
  const [tryResult, setTryResult] = useState<RuleTestOutcome | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = agentId
      ? getAgentRules(agentId).then((state) => {
          if (cancelled) return
          setCeiling(state.autonomyLevel)
          setRules(state.rules)
          setInherited(state.workspaceRules)
        })
      : getWorkspaceRules().then((rows) => {
          if (!cancelled) setRules(rows)
        })
    load.catch((err) => toast.error(formatApiErrorMessage(err, t('agentRules.loadError'))))
    getAllowances()
      .then((res) => {
        if (!cancelled) setTools(res.tools.filter((tool) => tool.mutating && tool.gated))
      })
      .catch(() => setTools([]))
    return () => {
      cancelled = true
    }
  }, [agentId, t])

  const categories = useMemo(() => [...new Set(tools.map((tool) => tool.category))].sort(), [tools])

  const persist = async (next: AgentRule[], nextCeiling?: AutonomyMode) => {
    setSaving(true)
    try {
      if (agentId) {
        const state = await saveAgentRules(agentId, { rules: next, autonomyLevel: nextCeiling })
        setCeiling(state.autonomyLevel)
        setRules(state.rules)
      } else {
        setRules(await saveWorkspaceRules(next))
      }
      return true
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('agentRules.saveError')))
      return false
    } finally {
      setSaving(false)
    }
  }

  const addRule = async () => {
    const text = draft.text.trim()
    if (!text) return
    const [targetKind, targetValue] = draft.target.split(':', 2)
    const rule: AgentRule = {
      id: '',
      text,
      mode: draft.mode,
      kind: draft.kind,
      tool: draft.kind === 'hard' && targetKind === 'tool' ? targetValue : '',
      category: draft.kind === 'hard' && targetKind === 'category' ? targetValue : '',
      uses: 0,
      approved: 0,
      rejected: 0,
    }
    if (await persist([...rules, rule])) setDraft(EMPTY_DRAFT)
  }

  const runTry = async () => {
    if (!tryTool) return
    const certainty = tryCertainty.trim() ? Number(tryCertainty) : null
    try {
      setTryResult(
        agentId
          ? await testAgentRules(agentId, { tool: tryTool, certainty })
          : await testWorkspaceRules({ tool: tryTool, certainty }),
      )
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('agentRules.tryError')))
    }
  }

  const modeOptions = MODES.filter((mode) => mode !== 'autonomous' || canGrant)
  const hardTargetMissing = draft.kind === 'hard' && !draft.target
  const allRules = [...inherited.map((r) => ({ ...r, inherited: true })), ...rules.map((r) => ({ ...r, inherited: false }))]

  return (
    <Card className="px-4 py-3" data-testid="agent-rules">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-text-heading">
            {agentId ? t('agentRules.title') : t('agentRules.workspaceTitle')}
          </h3>
          <p className="mt-1 text-sm text-text-muted">
            {agentId ? t('agentRules.hint') : t('agentRules.workspaceHint')}
          </p>
        </div>
        {agentId ? (
          <Select
            value={ceiling}
            disabled={!canEdit || saving}
            onValueChange={(value) => void persist(rules, value as AutonomyMode)}
          >
            <SelectTrigger className="h-8 w-[180px] text-xs" aria-label={t('agentRules.ceiling')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODES.filter((mode) => mode !== 'autonomous' || canGrant || ceiling === 'autonomous').map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {t(`teamPage.ceiling.${mode}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>
      {agentId ? <p className="mt-2 text-xs text-text-muted">{t(`agentRules.ceilingHint.${ceiling}`)}</p> : null}

      <div className="mt-4 space-y-2">
        <p className="text-xs font-medium text-text-secondary">{t('agentRules.rulesTitle')}</p>
        {allRules.length === 0 ? <p className="text-sm text-text-muted">{t('agentRules.empty')}</p> : null}
        {allRules.map((rule) => (
          <div
            key={`${rule.inherited ? 'w' : 'a'}-${rule.id}`}
            className="flex items-start justify-between gap-3 rounded-lg border border-border/60 px-3 py-2"
          >
            <div className="min-w-0">
              <p className="text-sm text-text-primary">{rule.text}</p>
              <p className="mt-0.5 text-2xs text-text-muted">
                {t(`agentRules.modeLine.${rule.mode}`)}
                {' · '}
                {rule.kind === 'hard'
                  ? t('agentRules.hardFor', {
                      target: rule.tool ? humanizeLabel(rule.tool) : toolCategoryLabel(rule.category, tGovern),
                    })
                  : t('agentRules.judgement')}
                {' · '}
                {t('agentRules.counts', { uses: rule.uses, approved: rule.approved, rejected: rule.rejected })}
                {rule.inherited ? ` · ${t('agentRules.fromWorkspace')}` : ''}
              </p>
            </div>
            {!rule.inherited && canEdit ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 w-7 shrink-0 p-0 text-text-muted"
                aria-label={t('agentRules.remove')}
                disabled={saving}
                onClick={() => void persist(rules.filter((r) => r.id !== rule.id))}
              >
                <Trash2 size={13} />
              </Button>
            ) : null}
          </div>
        ))}
      </div>

      {canEdit ? (
        <div className="mt-3 space-y-2 rounded-lg border border-dashed border-border/70 p-3">
          <Input
            value={draft.text}
            placeholder={t('agentRules.textPlaceholder')}
            onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Select value={draft.mode} onValueChange={(value) => setDraft((d) => ({ ...d, mode: value as AutonomyMode }))}>
              <SelectTrigger className="h-8 w-[180px] text-xs" aria-label={t('agentRules.mode')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {modeOptions.map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {t(`agentRules.modeLine.${mode}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={draft.kind}
              onValueChange={(value) => setDraft((d) => ({ ...d, kind: value as RuleKind, target: '' }))}
            >
              <SelectTrigger className="h-8 w-[200px] text-xs" aria-label={t('agentRules.kind')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="judgement">{t('agentRules.kindJudgement')}</SelectItem>
                <SelectItem value="hard">{t('agentRules.kindHard')}</SelectItem>
              </SelectContent>
            </Select>
            {draft.kind === 'hard' ? (
              <Select value={draft.target} onValueChange={(value) => setDraft((d) => ({ ...d, target: value }))}>
                <SelectTrigger className="h-8 w-[220px] text-xs" aria-label={t('agentRules.target')}>
                  <SelectValue placeholder={t('agentRules.targetPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((category) => (
                    <SelectItem key={`c-${category}`} value={`category:${category}`}>
                      {t('agentRules.allIn', { category: toolCategoryLabel(category, tGovern) })}
                    </SelectItem>
                  ))}
                  {tools.map((tool) => (
                    <SelectItem key={`t-${tool.name}`} value={`tool:${tool.name}`}>
                      {humanizeLabel(tool.name)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            <Button
              type="button"
              size="sm"
              disabled={saving || !draft.text.trim() || hardTargetMissing}
              onClick={() => void addRule()}
            >
              <Plus size={13} className="mr-1" />
              {t('agentRules.add')}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mt-4 border-t border-border/40 pt-3">
        <p className="flex items-center gap-1.5 text-xs font-medium text-text-secondary">
          <FlaskConical size={12} aria-hidden />
          {t('agentRules.tryTitle')}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Select value={tryTool} onValueChange={setTryTool}>
            <SelectTrigger className="h-8 w-[220px] text-xs" aria-label={t('agentRules.tryAction')}>
              <SelectValue placeholder={t('agentRules.tryAction')} />
            </SelectTrigger>
            <SelectContent>
              {tools.map((tool) => (
                <SelectItem key={tool.name} value={tool.name}>
                  {humanizeLabel(tool.name)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="number"
            min={1}
            max={10}
            value={tryCertainty}
            placeholder={t('agentRules.tryCertainty')}
            aria-label={t('agentRules.tryCertainty')}
            className="h-8 w-[140px] text-xs"
            onChange={(e) => setTryCertainty(e.target.value)}
          />
          <Button type="button" size="sm" variant="secondary" disabled={!tryTool} onClick={() => void runTry()}>
            {t('agentRules.tryRun')}
          </Button>
        </div>
        {tryResult ? (
          <p className="mt-2 text-sm text-text-primary" data-testid="agent-rules-try-result">
            {t(`agentRules.outcome.${tryResult.outcome}`)}
            {tryResult.rule
              ? ` ${t('agentRules.outcomeRule', { rule: tryResult.rule.text })}`
              : tryResult.reason === 'low_certainty'
                ? ` ${t('agentRules.outcomeUnsure')}`
                : ` ${t('agentRules.outcomeDefault')}`}
          </p>
        ) : null}
      </div>
    </Card>
  )
}
