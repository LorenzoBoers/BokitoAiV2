import { withQuery } from '../url'

/**
 * Relative paths on the app API base for Govern (`APP_API_BASE` + `/govern/...`).
 */
export const governRoutes = {
  changes: (params?: { status?: string; limit?: number }) =>
    withQuery('/govern/changes', new URLSearchParams(
      Object.entries({
        ...(params?.status ? { status: params.status } : {}),
        ...(params?.limit != null ? { limit: String(params.limit) } : {}),
      }),
    )),
  change: (changeId: string) => `/govern/changes/${encodeURIComponent(changeId)}`,
  changeAccept: (changeId: string) => `/govern/changes/${encodeURIComponent(changeId)}/accept`,
  changeReject: (changeId: string) => `/govern/changes/${encodeURIComponent(changeId)}/reject`,
  changeRollback: (changeId: string) => `/govern/changes/${encodeURIComponent(changeId)}/rollback`,
  audit: (limit = 50) => withQuery('/govern/audit', new URLSearchParams({ limit: String(limit) })),
  passports: '/govern/passports',
  passport: (agentId: string) => `/govern/passports/${encodeURIComponent(agentId)}`,
  allowances: '/govern/allowances',
  toolOverrides: '/govern/tool-overrides',
  posture: '/govern/posture',
  autonomyScopes: '/govern/autonomy-scopes',
  autonomyScope: (kind: string, id: string) =>
    `/govern/autonomy-scopes/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`,
  rules: '/govern/rules',
  rulesTest: '/govern/rules/test',
  agentRules: '/govern/agent-rules',
  agentRule: (agentId: string, ruleId: string) =>
    `/govern/agent-rules/${encodeURIComponent(agentId)}/${encodeURIComponent(ruleId)}`,
  tokens: '/govern/tokens',
  token: (tokenId: string) => `/govern/tokens/${encodeURIComponent(tokenId)}`,
}
