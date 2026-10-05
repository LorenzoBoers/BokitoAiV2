const rawVersion = (import.meta.env.VITE_APP_VERSION || '').trim()

/** Baked release id (git SHA or tag). Empty in local Vite when unset. */
export const RELEASE_VERSION = rawVersion

/** Login/signup footer. Local builds show `local`, not a fake environment name. */
export const APP_VERSION = RELEASE_VERSION || 'local'
