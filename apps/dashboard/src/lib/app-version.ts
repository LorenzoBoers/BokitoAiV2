const rawVersion = (import.meta.env.VITE_APP_VERSION || '').trim()

export const APP_VERSION = rawVersion || 'local-dev'
