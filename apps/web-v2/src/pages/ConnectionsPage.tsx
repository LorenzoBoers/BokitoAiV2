import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { useAgents, useConnectionMutations, useConnections, useProviders } from '@/api/queries'
import type { Connection, ConnectionKind, Provider } from '@/api/types'
import { Badge, Dialog, Field, KeyValue, Loading, Page, PageHeader, Section, Switch, statusTone } from '@/components/ui'
import { dateTime } from '@/lib/format'

const GROUPS: Array<{ key: string; kinds: ConnectionKind[] }> = [
  { key: 'channels', kinds: ['email', 'whatsapp', 'widget', 'phone', 'slack'] },
  { key: 'models', kinds: ['model_provider'] },
  { key: 'tools', kinds: ['mcp', 'integration', 'workbench'] },
]

export function ConnectionsPage() {
  const { t } = useTranslation()
  const connections = useConnections()
  const providers = useProviders()
  const [adding, setAdding] = useState<ConnectionKind | null>(null)

  return (
    <Page>
      <PageHeader title={t('nav.connections')} intro={t('surface.connectionsIntro')} />
      <div className="space-y-6 overflow-auto p-6">
        {!connections.data ? (
          <Loading />
        ) : (
          GROUPS.map((g) => {
            const items = connections.data.filter((c) => g.kinds.includes(c.kind))
            const available = g.kinds.filter((k) => (providers.data?.[k] ?? []).length > 0)
            return (
              <Section
                key={g.key}
                title={t(`connections.group.${g.key}`)}
                description={t(`connections.groupHint.${g.key}`)}
                actions={
                  <div className="flex flex-wrap gap-1.5">
                    {available.map((k) => (
                      <button key={k} type="button" className="btn-outline h-8" onClick={() => setAdding(k)}>
                        <Plus className="h-3.5 w-3.5" />
                        {t(`connections.kind.${k}`)}
                      </button>
                    ))}
                  </div>
                }
              >
                {items.length === 0 ? (
                  <p className="text-xs text-text-muted">{t('connections.none')}</p>
                ) : (
                  <ul className="grid gap-3 md:grid-cols-2">
                    {items.map((c) => (
                      <li key={c.id}>
                        <ConnectionCard connection={c} />
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            )
          })
        )}
      </div>
      {adding && <AddConnectionDialog kind={adding} providers={providers.data?.[adding] ?? []} onClose={() => setAdding(null)} />}
    </Page>
  )
}

function ConnectionCard({ connection: c }: { connection: Connection }) {
  const { t, i18n } = useTranslation()
  const m = useConnectionMutations()
  const agents = useAgents()
  async function run<T>(p: Promise<T>) {
    try {
      await p
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error'))
    }
  }
  const isChannel = ['email', 'whatsapp', 'widget', 'phone', 'slack'].includes(c.kind)
  const embed = c.kind === 'widget' ? `<script src="${window.location.origin}/widget.js" data-key="${c.public_key}" async></script>` : null
  return (
    <div className="rounded-xl border border-border/60 p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-text-heading">{c.name}</span>
            <Badge tone={statusTone(c.status)}>{t(`connectionStatus.${c.status}`)}</Badge>
            <span className="chip">{c.provider}</span>
            {c.region && <span className="chip uppercase">{c.region}</span>}
          </div>
          {c.status_message && <p className="mt-0.5 text-2xs text-status-error">{c.status_message}</p>}
        </div>
        <div className="flex gap-1">
          {c.status !== 'active' && (
            <button type="button" className="btn-outline h-7 text-2xs" onClick={() => void run(m.verify.mutateAsync(c.id))}>
              {t('connections.verify')}
            </button>
          )}
          <button type="button" className="btn-ghost h-7 text-2xs text-status-error" onClick={() => void run(m.remove.mutateAsync(c.id))}>
            {t('common.remove')}
          </button>
        </div>
      </div>
      <div className="mt-3">
        <KeyValue
          rows={[
            ...(c.address ? [[t('connections.address'), <code key="a" className="select-all">{c.address}</code>] as [string, React.ReactNode]] : []),
            ...Object.entries(c.credentials_masked).map(([k, v]) => [k, <code key={k}>{v}</code>] as [string, React.ReactNode]),
            ...(c.kind === 'whatsapp'
              ? [[t('connections.webhook'), <code key="w" className="select-all">{`${window.location.origin}/api/inbound/whatsapp`}</code>] as [string, React.ReactNode]]
              : []),
            ...(c.kind === 'phone'
              ? [[t('connections.webhook'), <code key="p" className="select-all">{`${window.location.origin}/api/inbound/phone/${c.public_key}`}</code>] as [string, React.ReactNode]]
              : []),
            ...(embed ? [[t('connections.embed'), <code key="e" className="select-all break-all text-2xs">{embed}</code>] as [string, React.ReactNode]] : []),
            [t('connections.lastUsed'), c.last_used_at ? dateTime(c.last_used_at, i18n.language) : '—'],
          ]}
        />
      </div>
      {isChannel && (
        <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-border/40 pt-3 text-xs">
          <label className="flex items-center gap-2 text-text-secondary">
            <Switch checked={c.disclosure_enabled} onChange={(v) => void run(m.update.mutateAsync({ id: c.id, disclosure_enabled: v }))} label={t('connections.disclosure')} />
            {t('connections.disclosure')}
          </label>
          <label className="flex items-center gap-2 text-text-secondary">
            {t('connections.agent')}
            <select className="field h-7 w-auto text-xs" value={c.agent_id ?? ''} onChange={(e) => void run(m.update.mutateAsync({ id: c.id, agent_id: e.target.value || null }))}>
              <option value="">{t('work.defaultAgent')}</option>
              {(agents.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  )
}

function AddConnectionDialog({ kind, providers, onClose }: { kind: ConnectionKind; providers: Provider[]; onClose: () => void }) {
  const { t } = useTranslation()
  const m = useConnectionMutations()
  const [provider, setProvider] = useState(providers[0]?.provider ?? '')
  const [name, setName] = useState('')
  const [creds, setCreds] = useState<Record<string, string>>({})
  const p = providers.find((x) => x.provider === provider)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    try {
      const out = await m.create.mutateAsync({ kind, provider, name: name || p?.name || kind, credentials: creds, region: p?.region ?? 'eu' })
      toast.success(t('connections.added', { name: out.name }))
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'))
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t('connections.add', { kind: t(`connections.kind.${kind}`) })} description={p?.description}>
      <form onSubmit={submit} className="space-y-3">
        {providers.length > 1 && (
          <Field label={t('connections.provider')}>
            <select
              className="field"
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value)
                setCreds({})
              }}
            >
              {providers.map((x) => (
                <option key={x.provider} value={x.provider}>
                  {x.name}
                  {x.region ? ` (${x.region.toUpperCase()})` : ''}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label={t('common.name')}>
          <input className="field" value={name} placeholder={p?.name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        {(p?.fields ?? []).map((f) => (
          <Field key={f} label={f}>
            <input
              className="field font-mono"
              type={/key|token|secret|password/i.test(f) ? 'password' : 'text'}
              value={creds[f] ?? ''}
              onChange={(e) => setCreds({ ...creds, [f]: e.target.value })}
              required
            />
          </Field>
        ))}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn-primary" disabled={m.create.isPending}>
            {t('common.add')}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
