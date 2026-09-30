import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import {
  useAudit,
  useChangeMutations,
  useChanges,
  useOutcomes,
  usePolicy,
  usePolicyMutations,
  useTokenMutations,
  useTokens,
  useUsage,
} from '@/api/queries'
import type { Posture, ToolCategory, Verdict } from '@/api/types'
import { Badge, Dialog, Field, Loading, Page, PageHeader, Section, Stat, TabPanel, Tabs, statusTone } from '@/components/ui'
import { cn } from '@/lib/cn'
import { dateTime, eur, percent } from '@/lib/format'

const TABS = ['policy', 'changes', 'audit', 'usage', 'tokens'] as const
type Tab = (typeof TABS)[number]
const POSTURES: Posture[] = ['manual', 'assisted', 'autonomous']
const CATEGORIES: ToolCategory[] = ['read', 'write', 'communicate', 'external', 'destructive']
const VERDICTS: Verdict[] = ['allow', 'ask', 'deny']

export function GovernPage() {
  const { t } = useTranslation()
  const { tab = 'policy' } = useParams()
  const navigate = useNavigate()
  const current: Tab = (TABS as readonly string[]).includes(tab) ? (tab as Tab) : 'policy'
  return (
    <Page>
      <PageHeader title={t('nav.govern')} intro={t('surface.governIntro')} />
      <Tabs
        value={current}
        onValueChange={(v) => navigate(v === 'policy' ? '/govern' : `/govern/${v}`)}
        items={TABS.map((v) => ({ value: v, label: t(`govern.tabs.${v}`) }))}
      >
        <div className="min-h-0 flex-1 overflow-auto p-6">
          <TabPanel value="policy">
            <PolicyTab />
          </TabPanel>
          <TabPanel value="changes">
            <ChangesTab />
          </TabPanel>
          <TabPanel value="audit">
            <AuditTab />
          </TabPanel>
          <TabPanel value="usage">
            <UsageTab />
          </TabPanel>
          <TabPanel value="tokens">
            <TokensTab />
          </TabPanel>
        </div>
      </Tabs>
    </Page>
  )
}

function PolicyTab() {
  const { t } = useTranslation()
  const policy = usePolicy()
  const m = usePolicyMutations()
  const [disclosure, setDisclosure] = useState<string | null>(null)
  if (!policy.data) return <Loading />
  const p = policy.data

  async function run<T>(pr: Promise<T>, ok?: string) {
    try {
      await pr
      if (ok) toast.success(ok)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error'))
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title={t('govern.posture')} description={t('govern.postureHint')} className="lg:col-span-2">
        <div className="grid gap-2 sm:grid-cols-3">
          {POSTURES.map((pos) => (
            <button
              key={pos}
              type="button"
              onClick={() =>
                void run(
                  m.setPosture.mutateAsync(pos).then((outcome) => {
                    if (outcome.status === 'decision') toast.message(t('govern.postureDecision'))
                  }),
                )
              }
              className={cn(
                'rounded-xl border p-3 text-left transition-colors hover:bg-bg-hover',
                p.posture === pos ? 'border-accent bg-accent/5' : 'border-border/60',
              )}
            >
              <div className="text-sm font-semibold text-text-heading">{t(`posture.${pos}`)}</div>
              <div className="mt-0.5 text-xs text-text-muted">{t(`govern.postureDesc.${pos}`)}</div>
            </button>
          ))}
        </div>
      </Section>

      <Section title={t('govern.allowances')} description={t('govern.allowancesHint')}>
        <table className="w-full text-xs">
          <tbody>
            {CATEGORIES.map((cat) => {
              const value = p.allowances[cat]
              return (
                <tr key={cat} className="border-t border-border/40">
                  <td className="py-2 pr-3">
                    <div className="font-medium text-text-primary">{t(`govern.category.${cat}`)}</div>
                    <div className="text-2xs text-text-muted">{t(`govern.categoryDesc.${cat}`)}</div>
                  </td>
                  <td className="py-2 text-right">
                    <div className="inline-flex rounded-lg border border-border/60 p-0.5">
                      <button
                        type="button"
                        onClick={() => void run(m.setAllowance.mutateAsync({ category: cat, verdict: null }))}
                        className={cn('rounded-md px-2 py-1 text-2xs', value === undefined ? 'bg-bg-hover text-text-heading' : 'text-text-muted')}
                      >
                        {t('govern.inherit')}
                      </button>
                      {VERDICTS.map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => void run(m.setAllowance.mutateAsync({ category: cat, verdict: v }))}
                          className={cn('rounded-md px-2 py-1 text-2xs', value === v ? 'bg-bg-hover text-text-heading' : 'text-text-muted')}
                        >
                          {t(`verdict.${v}`)}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Section>

      <div className="space-y-4">
        <Section title={t('govern.consequential')} description={t('govern.consequentialHint')}>
          <div className="flex flex-wrap gap-1">
            {p.consequential.map((name) => (
              <span key={name} className="chip font-mono">
                {name}
              </span>
            ))}
          </div>
          {Object.keys(p.tool_overrides).length > 0 && (
            <div className="mt-3">
              <div className="mb-1 text-2xs uppercase text-text-muted">{t('govern.toolOverrides')}</div>
              <ul className="space-y-1">
                {Object.entries(p.tool_overrides).map(([name, v]) => (
                  <li key={name} className="flex items-center gap-2 text-xs">
                    <span className="font-mono">{name}</span>
                    <Badge tone={v === 'deny' ? 'error' : v === 'ask' ? 'warning' : 'success'}>{t(`verdict.${v}`)}</Badge>
                    <button
                      type="button"
                      className="ml-auto text-2xs text-text-muted hover:text-text-primary"
                      onClick={() => void run(m.setAllowance.mutateAsync({ tool_name: name, verdict: null }))}
                    >
                      {t('common.remove')}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>

        <Section title={t('govern.disclosure')} description={t('govern.disclosureHint')}>
          <textarea
            className="field min-h-[72px]"
            value={disclosure ?? p.disclosure_text}
            placeholder={t('govern.disclosureDefault')}
            onChange={(e) => setDisclosure(e.target.value)}
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              className="btn-primary"
              disabled={disclosure === null || disclosure === p.disclosure_text}
              onClick={() => void run(m.setDisclosure.mutateAsync(disclosure ?? ''), t('common.saved')).then(() => setDisclosure(null))}
            >
              {t('common.save')}
            </button>
          </div>
        </Section>
      </div>
    </div>
  )
}

function ChangesTab() {
  const { t, i18n } = useTranslation()
  const changes = useChanges()
  const m = useChangeMutations()
  if (!changes.data) return <Loading />

  async function run<T>(pr: Promise<T>) {
    try {
      await pr
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error'))
    }
  }

  return (
    <Section title={t('govern.tabs.changes')} description={t('govern.changesHint')}>
      {changes.data.length === 0 && <p className="text-xs text-text-muted">{t('common.empty')}</p>}
      <ul className="divide-y divide-border/40">
        {changes.data.map((c) => (
          <li key={c.id} className="flex flex-wrap items-start gap-3 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-text-heading">{c.title}</span>
                <Badge tone={statusTone(c.status)}>{t(`changeStatus.${c.status}`)}</Badge>
                <span className="chip">{c.target_kind}</span>
              </div>
              <div className="mt-0.5 text-2xs text-text-muted">
                {c.proposed_by} · {dateTime(c.created_at, i18n.language)}
              </div>
              <details className="mt-1">
                <summary className="cursor-pointer text-2xs text-text-muted">{t('govern.diff')}</summary>
                <div className="mt-1 grid gap-2 sm:grid-cols-2">
                  <pre className="max-h-48 overflow-auto rounded-lg bg-bg-elevated p-2 text-2xs">{JSON.stringify(c.before, null, 2)}</pre>
                  <pre className="max-h-48 overflow-auto rounded-lg bg-bg-elevated p-2 text-2xs">{JSON.stringify(c.after, null, 2)}</pre>
                </div>
              </details>
            </div>
            <div className="flex gap-1.5">
              {c.status === 'draft' && (
                <>
                  <button type="button" className="btn-primary h-8" onClick={() => void run(m.apply.mutateAsync(c.id))}>
                    {t('govern.apply')}
                  </button>
                  <button type="button" className="btn-outline h-8" onClick={() => void run(m.reject.mutateAsync(c.id))}>
                    {t('govern.reject')}
                  </button>
                </>
              )}
              {c.status === 'applied' && c.before && (
                <button type="button" className="btn-outline h-8" onClick={() => void run(m.rollback.mutateAsync(c.id))}>
                  {t('govern.rollback')}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Section>
  )
}

function AuditTab() {
  const { t, i18n } = useTranslation()
  const [action, setAction] = useState('')
  const audit = useAudit({ action: action || undefined })
  return (
    <Section
      title={t('govern.tabs.audit')}
      description={t('govern.auditHint')}
      actions={<input className="field h-8 w-52 text-xs" placeholder={t('govern.filterAction')} value={action} onChange={(e) => setAction(e.target.value)} />}
    >
      {!audit.data ? (
        <Loading />
      ) : (
        <table className="w-full text-xs">
          <thead className="text-left text-2xs uppercase text-text-muted">
            <tr>
              <th className="py-1 pr-3">{t('common.when')}</th>
              <th className="py-1 pr-3">{t('govern.action')}</th>
              <th className="py-1 pr-3">{t('govern.actor')}</th>
              <th className="py-1 pr-3">{t('govern.target')}</th>
              <th className="py-1">{t('govern.payload')}</th>
            </tr>
          </thead>
          <tbody>
            {audit.data.map((e) => (
              <tr key={e.id} className="border-t border-border/40 align-top">
                <td className="whitespace-nowrap py-1.5 pr-3 text-text-muted">{dateTime(e.created_at, i18n.language)}</td>
                <td className="py-1.5 pr-3 font-mono">{e.action}</td>
                <td className="py-1.5 pr-3">
                  <span className="font-mono text-2xs">{e.actor}</span> <Badge>{e.trust}</Badge>
                </td>
                <td className="py-1.5 pr-3 text-text-muted">
                  {e.target_kind} {e.target_id.slice(0, 8)}
                </td>
                <td className="py-1.5 font-mono text-2xs text-text-muted">{JSON.stringify(e.payload)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  )
}

function UsageTab() {
  const { t, i18n } = useTranslation()
  const usage = useUsage()
  const outcomes = useOutcomes()
  if (!usage.data) return <Loading />
  const u = usage.data
  const max = Math.max(...u.by_day.map((d) => d.cost_eur), 0.0001)
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label={t('govern.total30d')} value={eur(u.total_cost_eur, i18n.language)} />
        <Stat label={t('govern.euShare')} value={percent(u.eu_share)} hint={t('govern.euShareHint')} />
        <Stat label={t('overview.resolved')} value={outcomes.data ? percent(outcomes.data.resolution_rate) : '—'} />
        <Stat label={t('overview.saved')} value={outcomes.data ? `${outcomes.data.time_saved_hours} h` : '—'} />
      </div>
      <Section title={t('govern.byDay')}>
        <div className="flex h-28 items-end gap-1">
          {u.by_day.map((d) => (
            <div key={d.day} className="flex flex-1 flex-col items-center gap-1" title={`${d.day}: ${eur(d.cost_eur, i18n.language, 4)}`}>
              <div className="w-full rounded-t bg-accent/60" style={{ height: `${Math.max(2, (d.cost_eur / max) * 100)}%` }} />
            </div>
          ))}
          {u.by_day.length === 0 && <p className="text-xs text-text-muted">{t('common.empty')}</p>}
        </div>
      </Section>
      <Section title={t('govern.lines')}>
        <table className="w-full text-xs">
          <thead className="text-left text-2xs uppercase text-text-muted">
            <tr>
              <th className="py-1 pr-3">{t('govern.kind')}</th>
              <th className="py-1 pr-3">{t('govern.provider')}</th>
              <th className="py-1 pr-3">{t('govern.region')}</th>
              <th className="py-1 pr-3 text-right">{t('govern.events')}</th>
              <th className="py-1 pr-3 text-right">{t('govern.tokens')}</th>
              <th className="py-1 text-right">{t('work.cost')}</th>
            </tr>
          </thead>
          <tbody>
            {u.lines.map((l, i) => (
              <tr key={i} className="border-t border-border/40">
                <td className="py-1.5 pr-3">{l.kind}</td>
                <td className="py-1.5 pr-3">
                  {l.provider} {l.billed_by_tenant && <Badge>{t('govern.byok')}</Badge>}
                </td>
                <td className="py-1.5 pr-3 uppercase text-text-muted">{l.region || '—'}</td>
                <td className="py-1.5 pr-3 text-right">{l.events}</td>
                <td className="py-1.5 pr-3 text-right text-text-muted">{l.tokens_in + l.tokens_out || '—'}</td>
                <td className="py-1.5 text-right">{eur(l.cost_eur, i18n.language, 4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  )
}

function TokensTab() {
  const { t, i18n } = useTranslation()
  const tokens = useTokens()
  const m = useTokenMutations()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [created, setCreated] = useState<string | null>(null)

  async function create(e: React.FormEvent) {
    e.preventDefault()
    try {
      const tok = await m.create.mutateAsync({ name, scopes: ['tools'] })
      setCreated(tok.token ?? null)
      setName('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'))
    }
  }

  return (
    <Section
      title={t('govern.tabs.tokens')}
      description={t('govern.tokensHint')}
      actions={
        <button type="button" className="btn-primary h-8" onClick={() => setOpen(true)}>
          {t('govern.newToken')}
        </button>
      }
    >
      {!tokens.data ? (
        <Loading />
      ) : tokens.data.length === 0 ? (
        <p className="text-xs text-text-muted">{t('common.empty')}</p>
      ) : (
        <ul className="divide-y divide-border/40">
          {tokens.data.map((tok) => (
            <li key={tok.id} className="flex items-center gap-3 py-2 text-xs">
              <span className="font-medium">{tok.name}</span>
              <span className="font-mono text-text-muted">{tok.prefix}…</span>
              {tok.revoked_at ? <Badge>{t('govern.revoked')}</Badge> : <Badge tone="success">{t('common.active')}</Badge>}
              <span className="ml-auto text-text-muted">{tok.last_used_at ? dateTime(tok.last_used_at, i18n.language) : t('govern.neverUsed')}</span>
              {!tok.revoked_at && (
                <button type="button" className="btn-ghost h-7 text-2xs" onClick={() => void m.revoke.mutateAsync(tok.id)}>
                  {t('govern.revoke')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (!o) setCreated(null)
        }}
        title={t('govern.newToken')}
        description={t('govern.newTokenHint')}
      >
        {created ? (
          <div className="space-y-3">
            <p className="text-xs text-text-secondary">{t('govern.copyToken')}</p>
            <code className="block break-all rounded-lg bg-bg-elevated p-3 font-mono text-xs">{created}</code>
            <div className="flex justify-end">
              <button type="button" className="btn-primary" onClick={() => void navigator.clipboard?.writeText(created)}>
                {t('common.copy')}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={create} className="space-y-3">
            <Field label={t('common.name')}>
              <input className="field" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
            </Field>
            <div className="flex justify-end">
              <button type="submit" className="btn-primary" disabled={m.create.isPending}>
                {t('common.create')}
              </button>
            </div>
          </form>
        )}
      </Dialog>
    </Section>
  )
}
