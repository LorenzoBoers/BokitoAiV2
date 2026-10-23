import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ShieldAlert, X } from 'lucide-react'
import { Badge } from '../../ui/badge'
import { Button } from '../../ui/button'
import { Card } from '../../ui/card'
import { DirectoryRowsSkeleton } from '../../ui/skeleton'
import { ChannelGlyph } from '../../ui/ChannelGlyph'
import { AiHandlingIcon } from '../../ai/AiHandlingIcon'
import type { AiHandlingScope } from '../../../lib/ai-handling'
import type { AiHandlingException, AiHandlingOverview } from '../../../lib/ai-handling-api'
import { inboxPath } from '../../../lib/messages-paths'
import { SectionHeading } from './SettingRow'

export type ExceptionScope = Extract<AiHandlingScope, 'channel' | 'conversation'> | 'flow'

function exceptionHref(scope: ExceptionScope, row: AiHandlingException): string {
  if (scope === 'conversation') return inboxPath('open', row.id)
  if (scope === 'flow') return `/flows/${row.id}`
  return '/settings/channels'
}

/** Channels (and open conversations) that sit below the dial. */
export function ChannelExceptionsCard({
  overview,
  onClear,
  onResumeBreaker,
}: {
  overview: AiHandlingOverview | null
  onClear: (scope: ExceptionScope, row: AiHandlingException) => void
  onResumeBreaker: (accountId: string) => void
}) {
  const { t } = useTranslation('nav')
  const { t: tc } = useTranslation('common')
  const groups = overview
    ? ([
        { scope: 'channel' as const, rows: overview.exceptions.channels },
        { scope: 'flow' as const, rows: overview.exceptions.flows },
        { scope: 'conversation' as const, rows: overview.exceptions.conversations },
      ] satisfies Array<{ scope: ExceptionScope; rows: AiHandlingException[] }>).filter((group) => group.rows.length > 0)
    : []

  return (
    <Card className="space-y-4 p-5" data-testid="ai-handling-exceptions">
      <SectionHeading
        title={t('ai.communication.exceptionsTitle')}
        description={t('ai.communication.exceptionsDescription')}
      />
      {!overview ? (
        <DirectoryRowsSkeleton rows={3} />
      ) : groups.length === 0 ? (
        <p className="text-xs text-text-secondary">{t('ai.communication.exceptionsEmpty')}</p>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <div key={group.scope}>
              <h4 className="mb-1.5 text-xs font-semibold text-text-muted">
                {t(`ai.communication.exceptionGroups.${group.scope}`)}
              </h4>
              <ul className="divide-y divide-border/50 rounded-lg border border-border">
                {group.rows.map((row) => (
                  <li key={row.id} className="flex items-center gap-2.5 px-3 py-2">
                    {row.mode ? <AiHandlingIcon mode={row.mode} size={14} /> : null}
                    {row.channel ? (
                      <ChannelGlyph channel={row.channel} size={13} className="shrink-0 text-text-muted" />
                    ) : null}
                    <Link
                      to={exceptionHref(group.scope, row)}
                      className="min-w-0 flex-1 truncate-fade text-sm text-text-primary hover:text-accent"
                    >
                      {row.label || row.contactName || row.address || row.id}
                    </Link>
                    {row.breakerTrippedAt ? (
                      <>
                        <Badge variant="warning" className="gap-1 px-1.5 py-0 text-2xs">
                          <ShieldAlert size={10} />
                          {tc('aiHandling.breakerBadge')}
                        </Badge>
                        {group.scope === 'channel' ? (
                          <Button size="sm" variant="secondary" onClick={() => onResumeBreaker(row.id)}>
                            {tc('aiHandling.breakerResume')}
                          </Button>
                        ) : null}
                      </>
                    ) : null}
                    {row.mode ? (
                      <span className="shrink-0 text-xs text-text-secondary">
                        {tc(`aiHandling.modes.${row.mode}.label`)}
                      </span>
                    ) : null}
                    {row.reason ? (
                      <span className="hidden shrink-0 text-xs text-text-muted sm:inline">
                        {tc(`aiHandling.reasons.${row.reason}`, { defaultValue: '' })}
                      </span>
                    ) : null}
                    {row.mode ? (
                      <button
                        type="button"
                        onClick={() => onClear(group.scope, row)}
                        title={t('ai.communication.exceptionClear')}
                        aria-label={t('ai.communication.exceptionClear')}
                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-text-muted hover:bg-bg-hover hover:text-text-primary"
                      >
                        <X size={13} />
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
