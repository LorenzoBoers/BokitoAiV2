import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Hammer } from 'lucide-react'
import { AiToolProviderRow } from './AiToolProviderRow'
import { WORKBENCH_PROVIDERS } from '../../lib/ai-tool-providers'

const DOCS_PATH = '/docs/developers/mcp-endpoint'

/** Outbound Workbench: coding tools Bokito will hand work to. Nothing is connectable yet. */
export function WorkbenchSection() {
  const { t } = useTranslation('nav')

  return (
    <section id="workbench" data-testid="workbench-providers">
      <h2 className="flex items-center gap-1.5 text-lg font-semibold text-text-heading">
        <Hammer size={15} className="text-text-muted" />
        {t('developersPage.workbench.title')}
      </h2>
      <p className="mt-1 text-sm leading-relaxed text-text-secondary">{t('developersPage.workbench.body')}</p>
      <div className="mt-4 space-y-2">
        {WORKBENCH_PROVIDERS.map((provider) => {
          const base = `developersPage.workbench.providers.${provider.id}`
          return (
            <AiToolProviderRow
              key={provider.id}
              brand={provider.brand}
              name={t(`${base}.name`)}
              description={t(`${base}.description`)}
              status={t('developersPage.workbench.notYet')}
              tone="muted"
              testId={`workbench-${provider.id}`}
            >
              <p className="text-sm leading-relaxed text-text-secondary">{t(`${base}.body`)}</p>
              <p className="text-xs text-text-muted">
                {t(`developersPage.workbench.phase${provider.phase}`)}
              </p>
              <Link to={DOCS_PATH} className="inline-block text-xs font-medium text-accent hover:underline">
                {t('developersPage.workbench.docsLink')}
              </Link>
            </AiToolProviderRow>
          )
        })}
      </div>
    </section>
  )
}
