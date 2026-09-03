import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { IntegrationHostLogo } from './IntegrationHostLogo'
import { Button } from '../ui/button'
import { CardGridSkeleton } from '../ui/skeleton'
import type { groupConnectionItems, ConnectionListItem } from '../../lib/connection-list'

type Props = {
  title: string
  loading: boolean
  groups: ReturnType<typeof groupConnectionItems>
  emptyLabel: string
  onOpenProgram: (programKey: string) => void
  onAttach: (row: ConnectionListItem) => void
  onDisconnect: (row: ConnectionListItem) => void
  /** MCP servers are one kind already; the kind heading would repeat the title. */
  hideKindHeading?: boolean
}

/** Installed connections grouped by kind and then by program. */
export function ConnectionSections({
  title,
  loading,
  groups,
  emptyLabel,
  onOpenProgram,
  onAttach,
  onDisconnect,
  hideKindHeading = false,
}: Props) {
  const { t } = useTranslation('nav')

  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted">{title}</h2>
      {loading ? (
        <CardGridSkeleton />
      ) : groups.length === 0 ? (
        <p className="text-sm text-text-muted">{emptyLabel}</p>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <div key={group.kind} className="space-y-3">
              {!hideKindHeading ? (
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-sm font-semibold text-text-heading">
                    {t(`integrations.kind.${group.kind}`)}
                  </h3>
                  {group.kind === 'repository' ? (
                    <p className="text-[11px] text-text-muted">
                      {t('integrations.connected.codeHint')}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <div className="space-y-4">
                {group.programs.map((program) => (
                  <div
                    key={program.programKey}
                    className="rounded-xl border border-border/60 bg-bg-surface"
                  >
                    <div className="flex items-center justify-between gap-3 border-b border-border/40 px-3 py-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <IntegrationHostLogo
                          logoUrl={program.brand.logoUrl}
                          logoDarkUrl={program.brand.logoDarkUrl}
                          initials={program.brand.initials}
                          color={program.brand.color}
                          name={program.programName}
                          hostSlug={program.brand.hostSlug}
                          size="sm"
                        />
                        <p className="truncate text-sm font-medium">{program.programName}</p>
                        <span className="text-[11px] tabular-nums text-text-muted">
                          {t('integrations.application.alreadyCount', {
                            count: program.items.length,
                          })}
                        </span>
                      </div>
                      {program.kind !== 'inbox' && program.kind !== 'calendar' ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onOpenProgram(program.programKey)}
                        >
                          {t('integrations.actions.connectAnother')}
                        </Button>
                      ) : null}
                    </div>
                    <ul>
                      {program.items.map((row) => {
                        const canAttach =
                          Boolean(row.eligibleModule) &&
                          !row.attachedModules.includes(row.eligibleModule ?? '')
                        return (
                          <li
                            key={row.id}
                            className="flex flex-wrap items-center justify-between gap-3 border-t border-border/30 px-3 py-2 first:border-t-0"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm text-text-heading">{row.title}</p>
                              <p className="truncate text-[11px] text-text-muted">
                                {row.attachedModules.length > 0
                                  ? row.attachedModules
                                      .map((slug) =>
                                        t(`integrations.modules.${slug}.name`, {
                                          defaultValue: slug,
                                        }),
                                      )
                                      .join(', ')
                                  : row.subtitle}
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {row.source === 'inbox' ? (
                                <Button size="sm" variant="outline" asChild>
                                  <Link to="/settings/channels">
                                    {t('integrations.connected.openChannels')}
                                  </Link>
                                </Button>
                              ) : null}
                              {row.source === 'calendar' ? (
                                <Button size="sm" variant="outline" asChild>
                                  <Link to="/agenda">{t('integrations.actions.manage')}</Link>
                                </Button>
                              ) : null}
                              {canAttach && row.eligibleModule ? (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => void onAttach(row)}
                                >
                                  {t('integrations.connected.useInModule', {
                                    name: t(`integrations.modules.${row.eligibleModule}.name`, {
                                      defaultValue: row.eligibleModule,
                                    }),
                                  })}
                                </Button>
                              ) : null}
                              {row.source !== 'inbox' && row.source !== 'calendar' ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => void onDisconnect(row)}
                                >
                                  {t('integrations.actions.disconnect')}
                                </Button>
                              ) : null}
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
