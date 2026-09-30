import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { useConversations, useDecisions, useOutcomes, usePolicy, useRuns, useUsage } from '@/api/queries'
import { ChannelIcon } from '@/components/ChannelIcon'
import { Badge, Page, PageHeader, Section, Stat, statusTone } from '@/components/ui'
import { eur, percent, relativeTime } from '@/lib/format'

import { DecisionCard } from './communication/DecisionCard'

export function OverviewPage() {
  const { t, i18n } = useTranslation()
  const attention = useConversations({ queue: 'attention', limit: 8 })
  const decisions = useDecisions()
  const outcomes = useOutcomes()
  const usage = useUsage()
  const policy = usePolicy()
  const runs = useRuns({ limit: 8 })

  const counts = attention.data?.counts ?? {}
  const channelCost = (usage.data?.lines ?? []).filter((l) => l.kind === 'channel_message').reduce((a, l) => a + l.cost_eur, 0)
  const modelCost = (usage.data?.lines ?? []).filter((l) => l.kind === 'llm' || l.kind === 'embedding').reduce((a, l) => a + l.cost_eur, 0)

  return (
    <Page>
      <PageHeader title={t('nav.overview')} intro={t('surface.overviewIntro')} />
      <div className="grid gap-4 overflow-auto p-6 lg:grid-cols-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:col-span-3 lg:grid-cols-5">
          <Stat label={t('overview.attention')} value={counts.attention ?? 0} hint={t('overview.attentionHint')} />
          <Stat
            label={t('overview.resolved')}
            value={outcomes.data ? percent(outcomes.data.resolution_rate) : '—'}
            hint={t('overview.resolvedHint', { n: outcomes.data?.resolved_by_agent ?? 0, total: outcomes.data?.conversations ?? 0 })}
            tone="success"
          />
          <Stat
            label={t('overview.saved')}
            value={outcomes.data ? `${outcomes.data.time_saved_hours} h` : '—'}
            hint={t('overview.savedHint')}
          />
          <Stat
            label={t('overview.cost')}
            value={usage.data ? eur(usage.data.total_cost_eur, i18n.language) : '—'}
            hint={t('overview.costHint', { models: eur(modelCost, i18n.language), channels: eur(channelCost, i18n.language) })}
          />
          <Stat
            label={t('overview.posture')}
            value={policy.data ? t(`posture.${policy.data.posture}`) : '—'}
            hint={t('overview.euShare', { share: percent(usage.data?.eu_share ?? 1) })}
          />
        </div>

        <Section
          title={t('overview.decisions')}
          description={t('overview.decisionsHint')}
          className="lg:col-span-2"
          actions={
            <Link to="/communication" className="btn-ghost h-7 px-2 text-xs">
              {t('overview.openCommunication')}
            </Link>
          }
        >
          {(decisions.data ?? []).length === 0 ? (
            <p className="text-xs text-text-muted">{t('overview.noDecisions')}</p>
          ) : (
            <ul className="space-y-2">
              {(decisions.data ?? []).slice(0, 5).map((d) => (
                <li key={d.id}>
                  <DecisionCard decision={d} compact />
                  <Link to={`/communication/${d.conversation_id}`} className="mt-1 inline-block text-2xs text-accent-ink hover:underline">
                    {t('overview.openThread')}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title={t('overview.needsYou')} description={t('overview.needsYouHint')}>
          <ul className="space-y-1">
            {(attention.data?.items ?? []).map((c) => (
              <li key={c.id}>
                <Link to={`/communication/${c.id}`} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-bg-hover">
                  <ChannelIcon channel={c.channel} className="text-text-muted" />
                  <span className="truncate">{c.subject || t('communication.noSubject')}</span>
                  <span className="ml-auto shrink-0 text-2xs text-text-muted">{relativeTime(c.last_activity_at, i18n.language)}</span>
                </Link>
              </li>
            ))}
            {attention.data && attention.data.items.length === 0 && <li className="text-xs text-text-muted">{t('overview.allQuiet')}</li>}
          </ul>
        </Section>

        <Section title={t('overview.recentRuns')} description={t('overview.recentRunsHint')} className="lg:col-span-3">
          <table className="w-full text-xs">
            <thead className="text-left text-2xs uppercase text-text-muted">
              <tr>
                <th className="py-1 pr-3">{t('work.run')}</th>
                <th className="py-1 pr-3">{t('work.kind')}</th>
                <th className="py-1 pr-3">{t('work.status')}</th>
                <th className="py-1 pr-3">{t('work.actor')}</th>
                <th className="py-1 pr-3 text-right">{t('work.cost')}</th>
                <th className="py-1 text-right">{t('common.when')}</th>
              </tr>
            </thead>
            <tbody>
              {(runs.data ?? []).map((r) => (
                <tr key={r.id} className="border-t border-border/40">
                  <td className="py-1.5 pr-3">
                    <Link to={`/work/runs/${r.id}`} className="hover:underline">
                      {r.title || r.tool_name || r.kind}
                    </Link>
                  </td>
                  <td className="py-1.5 pr-3 text-text-muted">{r.kind}</td>
                  <td className="py-1.5 pr-3">
                    <Badge tone={statusTone(r.status)}>{t(`runStatus.${r.status}`)}</Badge>
                  </td>
                  <td className="py-1.5 pr-3 font-mono text-2xs text-text-muted">{r.actor}</td>
                  <td className="py-1.5 pr-3 text-right">{r.cost_eur ? eur(r.cost_eur, i18n.language, 4) : '—'}</td>
                  <td className="py-1.5 text-right text-text-muted">{relativeTime(r.created_at, i18n.language)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {runs.data && runs.data.length === 0 && <p className="text-xs text-text-muted">{t('work.noRuns')}</p>}
        </Section>
      </div>
    </Page>
  )
}
