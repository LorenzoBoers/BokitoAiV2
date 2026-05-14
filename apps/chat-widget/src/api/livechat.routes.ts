/**
 * Path segments after `/api:livechat/` (no leading slash).
 * Central registry: build URLs with `livechatHttpUrl` from `./livechat-url`.
 */

/** Default portal auth API group slug for `/auth/me` when embedder does not override `hostMeUrl`. */
export const LIVECHAT_DEFAULT_HOST_AUTH_GROUP = 'DavdZOps' as const

export const livechatRoutes = {
  session: {
    start: 'session/start',
    identify: 'session/identify',
  },
  auth: {
    logout: 'auth/logout',
    login: 'auth/login',
    forgotPassword: 'auth/forgot-password',
    register: 'auth/register',
  },
  hostAuth: {
    me: 'auth/me',
  },
  attachment: 'attachment',
} as const
