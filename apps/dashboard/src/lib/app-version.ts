import versionFile from '../../../../VERSION?raw'

const PRODUCT_VERSION_RE = /^\d+\.\d+\.\d+$/

function clean(raw: string): string {
  return raw.trim()
}

/** Numbered release from the repo (`VERSION`), for example `1.2.01`. */
export const FILE_VERSION = clean(versionFile)

const baked = clean(import.meta.env.VITE_APP_VERSION || '')

/**
 * What this build should show. A baked product version wins (production and
 * staging images). A git SHA or `mvp` bake falls back to the VERSION file.
 * The Vite dev server always reads the file, so the dev host can move ahead
 * of the image that production is still running.
 */
export const RELEASE_VERSION = import.meta.env.DEV
  ? FILE_VERSION
  : PRODUCT_VERSION_RE.test(baked)
    ? baked
    : FILE_VERSION

/** Login/signup footer. */
export const APP_VERSION = RELEASE_VERSION || 'local'
