import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AmbientSpotlights } from '../ui/ambient-spotlights'
import { cn } from '../../lib/utils'

type AuthShellProps = {
  /** Line under the wordmark. */
  subtitle?: ReactNode
  /** Optional second line under the subtitle (product one-liner). */
  intro?: ReactNode
  /** Heading inside the card. */
  title?: ReactNode
  children: ReactNode
  cardClassName?: string
  /** Between the card and the copyright line (language switch). */
  above?: ReactNode
  /** Under the copyright line (build stamp, dev hints). */
  below?: ReactNode
}

/** Every signed-out page: wordmark, one card, one footer line. */
export function AuthShell({ subtitle, intro, title, children, cardClassName, above, below }: AuthShellProps) {
  const { t } = useTranslation('nav')
  return (
    <div className="app-atmosphere relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <AmbientSpotlights />
      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <img
            src="/bokito-logo.png"
            alt="Bokito.ai"
            className="mb-3 h-12 w-12"
            onError={(e) => {
              ;(e.target as HTMLImageElement).style.display = 'none'
            }}
          />
          <span className="text-2xl font-semibold tracking-tight text-text-heading">Bokito.ai</span>
          {subtitle ? <span className="mt-1 text-sm text-text-secondary">{subtitle}</span> : null}
          {intro ? <span className="mt-2 text-sm text-text-muted">{intro}</span> : null}
        </div>

        <div className={cn('panel animate-page-enter p-8 shadow-overlay', cardClassName)}>
          {title ? <h1 className="title-page mb-4 text-center">{title}</h1> : null}
          {children}
        </div>

        {above ? <div className="mt-5">{above}</div> : null}
        <p className={cn('text-center text-xs text-text-muted', above ? 'mt-3' : 'mt-6')}>
          © {new Date().getFullYear()} Bokito.ai · {t('loginPage.rights')}
          {' · '}
          <a href="/privacy.html" className="hover:text-accent">
            {t('loginPage.privacy')}
          </a>
        </p>
        {below}
      </div>
    </div>
  )
}

export default AuthShell
