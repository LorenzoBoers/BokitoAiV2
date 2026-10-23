import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowUpRight } from 'lucide-react'
import type { AiToolCardRow } from '../../lib/ai-tool-providers'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { BrandTile } from './BrandMark'

/** Card for an AI or coding tool; setup itself lives on Settings → Developers. */
export function AiToolCard({ row }: { row: AiToolCardRow }) {
  const { t } = useTranslation('nav')
  const name = t(`${row.copyKey}.name`)
  const description = t(`${row.copyKey}.description`)
  const kindLabel =
    row.direction === 'inbound'
      ? t('integrations.aiTools.kindInbound', { defaultValue: 'AI tool' })
      : t('integrations.aiTools.kindOutbound', { defaultValue: 'Coding tool' })

  return (
    <article className="panel hover-lift flex flex-col p-5 hover:border-border">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-text-heading">{name}</h3>
            <Badge variant="neutral" className="text-2xs font-medium">
              {kindLabel}
            </Badge>
          </div>
          <p className="line-clamp-2 text-xs leading-relaxed text-text-secondary">{description}</p>
        </div>
        <BrandTile slug={row.brand} size="md" />
      </div>
      <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-4">
        <span className="text-2xs text-text-muted">
          {row.direction === 'inbound'
            ? t('integrations.aiTools.inboundHint', { defaultValue: 'Uses this workspace over MCP' })
            : t('integrations.aiTools.outboundHint', { defaultValue: 'Takes work from a conversation' })}
        </span>
        <Button size="sm" variant="secondary" asChild>
          <Link to={row.href} className="gap-1">
            {t('integrations.aiTools.setup', { defaultValue: 'Set up' })}
            <ArrowUpRight size={14} />
          </Link>
        </Button>
      </div>
    </article>
  )
}
