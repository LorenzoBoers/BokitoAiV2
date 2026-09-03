import { useTranslation } from 'react-i18next'
import { Badge } from '../ui/badge'
import {
  moduleToolPath,
  resolveModuleToolCards,
  type IntegrationModuleRow,
} from '../../lib/integration-modules'
import type { AttachedMcpToolServer } from '../../lib/integrations-api'
import { cn } from '../../lib/utils'

type Props = {
  module: Pick<
    IntegrationModuleRow,
    | 'slug'
    | 'tool_cards'
    | 'verbs'
    | 'propose_verbs'
    | 'verb_labels'
    | 'attached_mcp_tools'
  >
  /** Compact list for dropdowns; full cards for overview. */
  compact?: boolean
  className?: string
}

/** Inline showcase of module tools (read + propose) with path and description. */
export function ModuleToolsetPanel({ module, compact = false, className }: Props) {
  const { t } = useTranslation('nav')
  const cards = resolveModuleToolCards(module)
  const attached = (module.attached_mcp_tools ?? []).filter(
    (row): row is AttachedMcpToolServer => Boolean(row?.server_id),
  )

  if (cards.length === 0 && attached.length === 0) return null

  const reads = cards.filter((c) => c.kind === 'read')
  const proposes = cards.filter((c) => c.kind === 'propose')

  const renderCard = (card: (typeof cards)[number]) => {
    const path = moduleToolPath(module.slug, card.verb)
    const label = t(`integrations.modules.tools.${module.slug}.${card.verb}.label`, {
      defaultValue: card.label,
    })
    const description = t(`integrations.modules.tools.${module.slug}.${card.verb}.description`, {
      defaultValue: card.description || card.label,
    })
    return (
      <li
        key={`${card.kind}-${card.verb}`}
        className={cn(
          'rounded-lg border border-border/50 bg-bg-muted/20',
          compact ? 'px-2.5 py-2' : 'px-3 py-2.5',
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn('font-medium text-text-heading', compact ? 'text-xs' : 'text-sm')}>
            {label}
          </span>
          {card.kind === 'propose' ? (
            <Badge variant="neutral" className="text-[10px] font-medium">
              {t('integrations.modules.toolNeedsApproval', {
                defaultValue: 'Needs approval',
              })}
            </Badge>
          ) : (
            <Badge variant="neutral" className="text-[10px] font-medium text-text-muted">
              {t('integrations.modules.toolRead', { defaultValue: 'Read' })}
            </Badge>
          )}
        </div>
        {!compact || description ? (
          <p className={cn('mt-0.5 text-text-secondary', compact ? 'text-[11px]' : 'text-xs')}>
            {description}
          </p>
        ) : null}
        <p className="mt-1 font-mono text-[10px] text-text-muted">{path}</p>
      </li>
    )
  }

  return (
    <div className={cn('space-y-3', className)}>
      {reads.length > 0 ? (
        <div>
          {!compact ? (
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-muted">
              {t('integrations.modules.toolsetTitle', {
                defaultValue: 'Actions this module can perform',
              })}
            </p>
          ) : null}
          <ul className={cn(compact ? 'space-y-1.5' : 'grid gap-2 sm:grid-cols-2')}>
            {reads.map(renderCard)}
          </ul>
        </div>
      ) : null}
      {proposes.length > 0 ? (
        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-muted">
            {t('integrations.modules.proposeToolset', {
              defaultValue: 'Writes (as decisions)',
            })}
          </p>
          <ul className={cn(compact ? 'space-y-1.5' : 'grid gap-2 sm:grid-cols-2')}>
            {proposes.map(renderCard)}
          </ul>
        </div>
      ) : null}
      {!compact && attached.length > 0 ? (
        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-muted">
            {t('integrations.modules.attachedMcpToolsTitle', {
              defaultValue: 'Tools from connected MCP servers',
            })}
          </p>
          <div className="space-y-3">
            {attached.map((server) => (
              <div
                key={server.server_id}
                className="rounded-lg border border-border/50 bg-bg-muted/10 px-3 py-2.5"
              >
                <p className="text-sm font-medium text-text-heading">{server.server_name}</p>
                <p className="mt-0.5 text-[11px] text-text-muted">
                  {server.provider}
                  {server.tools_synced_at
                    ? ` · ${t('integrations.modules.toolsSynced', {
                        defaultValue: 'Synced',
                      })}`
                    : ''}
                </p>
                {server.tools.length === 0 ? (
                  <p className="mt-2 text-xs text-text-muted">
                    {t('integrations.modules.attachedMcpToolsEmpty', {
                      defaultValue: 'No tools discovered on this server yet.',
                    })}
                  </p>
                ) : (
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {server.tools.map((tool) => (
                      <li key={`${server.server_id}-${tool.name}`}>
                        <Badge
                          variant="neutral"
                          className="font-mono text-[10px] font-normal"
                          title={tool.description || tool.name}
                        >
                          {tool.name}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
