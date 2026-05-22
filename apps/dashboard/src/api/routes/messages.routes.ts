import { withQuery } from '../url'

export const messagesRoutes = {
  listQuery: (params: URLSearchParams) => withQuery('/messages', params),
  byId: (messageId: string) => `/messages/${encodeURIComponent(messageId)}`,
  thread: (threadId: string) => `/messages/threads/${encodeURIComponent(threadId)}`,
  decisionApprove: (messageId: string) => `/messages/${encodeURIComponent(messageId)}/approve`,
  decisionDefer: (messageId: string) => `/messages/${encodeURIComponent(messageId)}/defer`,
  decisionReject: (messageId: string) => `/messages/${encodeURIComponent(messageId)}/reject`,
} as const
