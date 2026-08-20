/**
 * Optional Sentry error tracking for the dashboard.
 *
 * Loaded lazily so the SDK never lands in the bundle-critical path and the
 * app works identically without a DSN. VITE_SENTRY_DSN is a public value
 * (baked into the build); do not put secrets here.
 */
export function initSentry(): void {
  const dsn = (import.meta.env.VITE_SENTRY_DSN as string | undefined)?.trim()
  if (!dsn) return
  void import('@sentry/react')
    .then((Sentry) => {
      Sentry.init({
        dsn,
        environment: import.meta.env.MODE,
        tracesSampleRate: 0.05,
        sendDefaultPii: false,
      })
    })
    .catch(() => {
      // Error tracking is best-effort; never break app startup over it.
    })
}
