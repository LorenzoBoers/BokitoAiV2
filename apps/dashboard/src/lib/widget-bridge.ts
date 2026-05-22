const DASHBOARD_USER_PUBLISH_KEY = '__bokito_dashboard_user__'

declare global {
  interface Window {
    [DASHBOARD_USER_PUBLISH_KEY]?: unknown
  }
}

export function publishDashboardUserToWidget(user: {
  id: number | string
  name: string
  email: string
  avatarUrl?: string | null
} | null): void {
  if (typeof window === 'undefined') return
  if (!user) {
    window[DASHBOARD_USER_PUBLISH_KEY] = null
    return
  }
  window[DASHBOARD_USER_PUBLISH_KEY] = {
    id: user.id,
    name: user.name,
    email: user.email,
    avatar: user.avatarUrl ?? null,
  }
}

export function readPublishedDashboardUser(): unknown {
  if (typeof window === 'undefined') return null
  return window[DASHBOARD_USER_PUBLISH_KEY] ?? null
}
