import { withQuery } from '../url'

export const messagesRoutes = {
  listQuery: (params: URLSearchParams) => withQuery('/messages', params),
  decisionApprove: (messageId: string) => `/messages/${encodeURIComponent(messageId)}/approve`,
  decisionDefer: (messageId: string) => `/messages/${encodeURIComponent(messageId)}/defer`,
  decisionReject: (messageId: string) => `/messages/${encodeURIComponent(messageId)}/reject`,
} as const
