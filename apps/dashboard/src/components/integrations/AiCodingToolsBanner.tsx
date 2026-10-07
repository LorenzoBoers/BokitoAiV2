import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { aiCodingToolBrandSlugs } from '../../lib/ai-tool-providers'
import { Button } from '../ui/button'
import { BrandTile } from './BrandMark'

const HUB_BRANDS = aiCodingToolBrandSlugs()

/** One offer: inbound MCP from AI tools and outbound workbench coding tools. */
export default function AiCodingToolsBanner() {
  const { t } = useTranslation('nav')
  return (
    <section className="panel px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="flex flex-wrap items-center gap-1.5">
              {HUB_BRANDS.map((slug) => (
                <BrandTile key={slug} slug={slug} size="sm" />
              ))}
            </span>
            <p className="text-sm font-semibold text-text-heading">
              {t('integrations.aiCodingTools.title')}
            </p>
          </div>
          <p className="mt-1 max-w-3xl text-xs text-text-secondary">
            {t('integrations.aiCodingTools.body')}
          </p>
        </div>
        <Button size="sm" variant="secondary" asChild>
          <Link to="/settings/developers#connect-ai-tools">{t('integrations.aiCodingTools.cta')}</Link>
        </Button>
      </div>
    </section>
  )
}
