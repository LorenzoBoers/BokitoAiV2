/**
 * Relative paths on the livechat API group (`/api/livechat`).
 * Used by widget-main.ts; keep in sync with MULTI_TENANT_BACKEND_CONTRACT.md.
 */
export const livechatRoutes = {
  session: {
    start: '/session/start',
  },
  auth: {
    login: '/auth/login',
    logout: '/auth/logout',
    forgotPassword: '/auth/forgot-password',
    register: '/auth/register',
  },
  hostAuth: {
    me: '/me',
  },
  attachment: '/attachment',
  streamChat: '/stream-chat',
  streamChatContinue: '/stream-chat-continue',
  transcribe: '/transcribe',
  user: {
    conversations: '/user/conversations',
    preferences: '/user/preferences',
  },
  customer: {
    conversations: '/customer/conversations',
  },
} as const
