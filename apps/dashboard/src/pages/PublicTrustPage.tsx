import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

/**
 * Public security & privacy summary for /trust (marketing / counsel drafts).
 * Detailed operator controls live at /settings/trust after sign-in.
 */
export default function PublicTrustPage() {
  const { t } = useTranslation('nav')

  return (
    <div className="min-h-screen bg-bg-app text-text-primary">
      <header className="border-b border-border/50 px-6 py-4">
        <Link to="/login" className="inline-flex items-center gap-2 text-sm font-medium text-text-heading">
          <img src="/bokito-logo-in-circel.svg" alt="" className="h-7 w-7" />
          Bokito
        </Link>
      </header>
      <main className="mx-auto max-w-2xl space-y-8 px-6 py-12">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text-heading">
            {t('publicTrust.title')}
          </h1>
          <p className="mt-2 text-sm text-text-muted">{t('publicTrust.subtitle')}</p>
          <p className="mt-2 text-xs text-text-muted">{t('publicTrust.draftGate')}</p>
        </div>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-text-heading">{t('publicTrust.highlightsTitle')}</h2>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-text-secondary">
            <li>{t('publicTrust.mfa')}</li>
            <li>{t('publicTrust.encryption')}</li>
            <li>{t('publicTrust.audit')}</li>
            <li>{t('publicTrust.retention')}</li>
            <li>{t('publicTrust.dsar')}</li>
            <li>{t('publicTrust.ai')}</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-text-heading">{t('publicTrust.docsTitle')}</h2>
          <ul className="space-y-1 text-sm">
            <li>
              <a className="text-accent hover:underline" href="/docs/govern/privacy-security">
                {t('publicTrust.operatorGuide')}
              </a>
            </li>
            <li>
              <a
                className="text-accent hover:underline"
                href="https://github.com/bokito-ai/bokito/blob/master/docs/legal/SECURITY.md"
                target="_blank"
                rel="noreferrer"
              >
                {t('publicTrust.securityDoc')}
              </a>
            </li>
            <li>
              <a
                className="text-accent hover:underline"
                href="https://github.com/bokito-ai/bokito/blob/master/docs/legal/SUBPROCESSORS.md"
                target="_blank"
                rel="noreferrer"
              >
                {t('publicTrust.subprocessors')}
              </a>
            </li>
            <li>
              <a
                className="text-accent hover:underline"
                href="https://github.com/bokito-ai/bokito/blob/master/docs/legal/INCIDENT-RESPONSE.md"
                target="_blank"
                rel="noreferrer"
              >
                {t('publicTrust.incident')}
              </a>
            </li>
          </ul>
        </section>

        <p className="text-sm text-text-muted">
          <Link to="/login" className="text-accent hover:underline">
            {t('publicTrust.signIn')}
          </Link>
          {' · '}
          <Link to="/settings/trust" className="text-accent hover:underline">
            {t('publicTrust.workspaceTrust')}
          </Link>
        </p>
      </main>
    </div>
  )
}
