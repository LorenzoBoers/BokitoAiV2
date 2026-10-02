import { withQuery } from '../url'

/**
 * Relative paths on the app API base for AI handling (`APP_API_BASE` + `/ai-handling/...`).
 * Scopes: workspace, channel (ChannelAccount id), contact, conversation (Signal id).
 */
export const aiHandlingRoutes = {
  overview: '/ai-handling',
  settings: '/ai-handling/settings',
  metrics: (days = 30) => withQuery('/ai-handling/metrics', new URLSearchParams({ days: String(days) })),
  target: (scope: string, targetId: string) =>
    `/ai-handling/${encodeURIComponent(scope)}/${encodeURIComponent(targetId)}`,
  preview: (scope: string, targetId: string, mode?: string | null) =>
    withQuery(
      `/ai-handling/${encodeURIComponent(scope)}/${encodeURIComponent(targetId)}/preview`,
      new URLSearchParams(mode ? { mode } : {}),
    ),
  resetBreaker: (accountId: string, keepAssisted = false) =>
    withQuery(
      `/ai-handling/channel/${encodeURIComponent(accountId)}/reset-breaker`,
      new URLSearchParams(keepAssisted ? { keep_assisted: 'true' } : {}),
    ),
}
