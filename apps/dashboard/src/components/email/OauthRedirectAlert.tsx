import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

type OauthRedirectAlertProps = {
  variant: 'success' | 'error'
  /** Optional headline, e.g. "Outlook koppelen mislukt" */
  title?: string
  /** Main explanation (short) */
  children: ReactNode
  /** Optional raw provider / AAD text from `aad_detail` */
  technicalDetail?: string | null
  /** Error code from `outlook_error` / `oauth_error`, e.g. `token_exchange` */
  errorCode?: string | null
  onDismiss: () => void
}

export function OauthRedirectAlert({
  variant,
  title,
  children,
  technicalDetail,
  errorCode,
  onDismiss,
}: OauthRedirectAlertProps) {
  const isSuccess = variant === 'success'

  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2.5 text-xs',
        isSuccess
          ? 'border-status-success/40 bg-status-success/10 text-status-success'
          : 'border-status-error/40 bg-status-error/10 text-status-error',
      )}
    >
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 space-y-2 leading-snug">
          {!isSuccess && (title || errorCode) ? (
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              {title ? <p className="font-semibold text-text-heading">{title}</p> : null}
              {errorCode ? (
                <span className="rounded bg-bg-elevated px-1.5 py-0.5 font-mono text-2xs text-text-secondary">{errorCode}</span>
              ) : null}
            </div>
          ) : null}
          <div className={cn(!isSuccess && title ? 'text-text-secondary' : undefined)}>{children}</div>
          {!isSuccess && technicalDetail ? (
            <details className="text-text-secondary" open={import.meta.env.DEV}>
              <summary className="cursor-pointer select-none text-2xs underline underline-offset-2 hover:opacity-90">
                Technische details (van provider)
              </summary>
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded border border-border/60 bg-bg-elevated/90 p-2 font-mono text-2xs text-text-primary">
                {technicalDetail}
              </pre>
            </details>
          ) : null}
          {!isSuccess && !technicalDetail && import.meta.env.DEV ? (
            <p className="text-2xs text-text-muted">
              Ontbrekende technische details: laat de Xano Outlook-callback bij fout de Microsoft-respons (error / error_description) als query-parameter meesturen (bijv. aad_detail), dan verschijnt die hier.
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className="ml-auto shrink-0 self-start underline opacity-90 hover:opacity-100 sm:ml-0"
          onClick={onDismiss}
        >
          Sluiten
        </button>
      </div>
    </div>
  )
}
