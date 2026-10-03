import { apiGet, apiPost, apiPut, workforceGet, workforcePost, workforcePut } from './api'
import { appRoutes, governRoutes, workforceRoutes } from '../api/routes'

/** Agent ceiling and rule modes share the AI handling vocabulary. */
export type AutonomyMode = 'manual' | 'assisted' | 'autonomous'
export type RuleKind = 'hard' | 'judgement'

export type AgentRule = {
  id: string
  text: string
  mode: AutonomyMode
  kind: RuleKind
  tool: string
  category: string
  uses: number
  approved: number
  rejected: number
}

export type AgentRulesState = {
  autonomyLevel: AutonomyMode
  rules: AgentRule[]
  workspaceRules: AgentRule[]
}

export type RuleTestOutcome = {
  tool: string
  mode: 'allow' | 'ask' | 'deny'
  reason: string
  outcome: 'runs' | 'asks' | 'refused'
  rule: AgentRule | null
}

export type LearnChoice = 'allow' | 'ask' | 'unsure'

export type LearnResult = {
  status: string
  count: number | null
  changeId: string | null
}

const MODES: AutonomyMode[] = ['manual', 'assisted', 'autonomous']

export function normalizeAutonomy(value: unknown): AutonomyMode {
  if (value === 'approval') return 'assisted'
  if (value === 'auto') return 'autonomous'
  return MODES.includes(value as AutonomyMode) ? (value as AutonomyMode) : 'assisted'
}

function toRule(raw: Record<string, unknown>): AgentRule {
  return {
    id: String(raw.id ?? ''),
    text: String(raw.text ?? ''),
    mode: normalizeAutonomy(raw.mode),
    kind: raw.kind === 'hard' ? 'hard' : 'judgement',
    tool: String(raw.tool ?? ''),
    category: String(raw.category ?? ''),
    uses: Number(raw.uses ?? 0),
    approved: Number(raw.approved ?? 0),
    rejected: Number(raw.rejected ?? 0),
  }
}

function toRules(raw: unknown): AgentRule[] {
  return Array.isArray(raw) ? raw.filter((r) => r && typeof r === 'object').map((r) => toRule(r)) : []
}

function toRulePayload(rule: AgentRule) {
  return {
    id: rule.id,
    text: rule.text,
    mode: rule.mode,
    kind: rule.kind,
    tool: rule.kind === 'hard' ? rule.tool : '',
    category: rule.kind === 'hard' ? rule.category : '',
  }
}

function toState(raw: { autonomy_level?: unknown; rules?: unknown; workspace_rules?: unknown }): AgentRulesState {
  return {
    autonomyLevel: normalizeAutonomy(raw.autonomy_level),
    rules: toRules(raw.rules),
    workspaceRules: toRules(raw.workspace_rules),
  }
}

function toOutcome(raw: Record<string, unknown>): RuleTestOutcome {
  const outcome = raw.outcome === 'runs' || raw.outcome === 'refused' ? raw.outcome : 'asks'
  const mode = raw.mode === 'allow' || raw.mode === 'deny' ? raw.mode : 'ask'
  return {
    tool: String(raw.tool ?? ''),
    mode,
    reason: String(raw.reason ?? ''),
    outcome,
    rule: raw.rule && typeof raw.rule === 'object' ? toRule(raw.rule as Record<string, unknown>) : null,
  }
}

export async function getAgentRules(agentId: string): Promise<AgentRulesState> {
  return toState(await workforceGet(workforceRoutes.agents.rules(agentId)))
}

export async function saveAgentRules(
  agentId: string,
  patch: { autonomyLevel?: AutonomyMode; rules?: AgentRule[] },
): Promise<AgentRulesState> {
  const body: Record<string, unknown> = {}
  if (patch.autonomyLevel) body.autonomy_level = patch.autonomyLevel
  if (patch.rules) body.rules = patch.rules.map(toRulePayload)
  return toState(await workforcePut(workforceRoutes.agents.rules(agentId), body))
}

export async function testAgentRules(
  agentId: string,
  input: { tool: string; certainty?: number | null },
): Promise<RuleTestOutcome> {
  return toOutcome(
    await workforcePost(workforceRoutes.agents.rulesTest(agentId), {
      tool: input.tool,
      ...(input.certainty != null ? { certainty: input.certainty } : {}),
    }),
  )
}

export async function getWorkspaceRules(): Promise<AgentRule[]> {
  const raw = await apiGet<{ rules?: unknown }>(governRoutes.rules)
  return toRules(raw.rules)
}

export async function saveWorkspaceRules(rules: AgentRule[]): Promise<AgentRule[]> {
  const raw = await apiPut<{ rules?: unknown }>(governRoutes.rules, { rules: rules.map(toRulePayload) })
  return toRules(raw.rules)
}

export async function testWorkspaceRules(input: {
  tool: string
  agentId?: string | null
  certainty?: number | null
}): Promise<RuleTestOutcome> {
  return toOutcome(
    await apiPost(governRoutes.rulesTest, {
      tool: input.tool,
      ...(input.agentId ? { agent_id: input.agentId } : {}),
      ...(input.certainty != null ? { certainty: input.certainty } : {}),
    }),
  )
}

export async function learnFromDecision(decisionId: string, choice: LearnChoice): Promise<LearnResult> {
  const raw = await apiPost<{ status?: string; count?: number | null; change_id?: string | null }>(
    appRoutes.notifications.decisionLearn(decisionId),
    { choice },
  )
  return { status: String(raw.status ?? ''), count: raw.count ?? null, changeId: raw.change_id ?? null }
}
