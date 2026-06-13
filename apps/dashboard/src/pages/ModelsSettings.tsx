import { useCallback, useEffect, useState } from 'react'
import { Check, Cpu, Loader2, ShieldCheck } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { PageContent } from '../components/layout/PageContent'
import {
  bokitoGetTenantModels,
  bokitoUpdateTenantModels,
  bokitoStaffListModels,
  bokitoStaffUpsertModel,
  bokitoStaffGetPlatformKeys,
  bokitoStaffSetPlatformKey,
  bokitoStaffDeletePlatformKey,
  bokitoStaffSetMarkup,
  type CatalogModel,
  type LlmProvider,
  type PlatformKeysPayload,
  type TenantModelsPayload,
} from '../lib/bokito-api'

function pricePerMtok(cents: number): string {
  return `$${(cents / 100).toFixed(2)}/Mtok`
}

export default function ModelsSettings() {
  const { token, isStaff } = useAuth()
  const [data, setData] = useState<TenantModelsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const payload = await bokitoGetTenantModels(token)
      setData(payload)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load models.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  const update = useCallback(
    async (patch: Partial<TenantModelsPayload['prefs']>) => {
      if (!token || busy) return
      setBusy(true)
      setError(null)
      try {
        const next = await bokitoUpdateTenantModels(token, patch)
        setData(next)
        setSaved(true)
        window.setTimeout(() => setSaved(false), 2000)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save.')
      } finally {
        setBusy(false)
      }
    },
    [token, busy],
  )

  if (loading) {
    return (
      <PageContent width="lg" className="py-10">
        <div className="flex justify-center text-text-muted">
          <Loader2 size={18} className="animate-spin" />
        </div>
      </PageContent>
    )
  }

  const chatModels = data?.models.filter((m) => m.kind === 'chat') ?? []
  const embeddingModels = data?.models.filter((m) => m.kind === 'embedding') ?? []
  const allowed = data?.prefs.allowed_chat ?? []

  const toggleAllowed = (slug: string) => {
    const next = allowed.includes(slug) ? allowed.filter((s) => s !== slug) : [...allowed, slug]
    void update({ allowed_chat: next })
  }

  return (
    <PageContent width="lg" className="space-y-7 py-1">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-bg-surface text-accent">
          <Cpu size={18} />
        </span>
        <div>
          <h2 className="text-[15px] font-semibold text-text-heading">Models</h2>
          <p className="text-[12.5px] text-text-muted">
            Choose which models agents in this workspace can use and the defaults. Models run on your
            own keys when set (no markup); otherwise they use Bokito&apos;s keys and are billed per token.
          </p>
        </div>
      </div>

      {data ? (
        <div className="flex flex-wrap gap-2 text-[11.5px]">
          {(['anthropic', 'openai'] as const).map((p) => {
            const byok = data.byok.find((b) => b.provider === p)?.is_set
            return (
              <span
                key={p}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 ${
                  byok
                    ? 'border-status-success/40 bg-status-success/10 text-status-success'
                    : 'border-amber-400/40 bg-amber-400/10 text-amber-500'
                }`}
              >
                {p}: {byok ? 'Your key (no markup)' : 'Bokito key (billable)'}
              </span>
            )
          })}
        </div>
      ) : null}

      {error ? <p className="text-[12px] text-status-error">{error}</p> : null}
      {saved ? (
        <p className="inline-flex items-center gap-1 text-[12px] text-status-success">
          <Check size={13} /> Saved
        </p>
      ) : null}

      <section className="space-y-3">
        <h3 className="text-[13px] font-semibold text-text-heading">Default models</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-[11.5px] font-medium text-text-muted">Default chat model</span>
            <select
              value={data?.prefs.default_chat ?? ''}
              onChange={(e) => void update({ default_chat: e.target.value })}
              className="w-full rounded-lg border border-border/70 bg-bg-input px-3 py-2 text-[13px] text-text-primary"
            >
              <option value="">Platform default</option>
              {chatModels.map((m) => (
                <option key={m.slug} value={m.slug}>
                  {m.display_name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="text-[11.5px] font-medium text-text-muted">Default embedding model</span>
            <select
              value={data?.prefs.default_embedding ?? ''}
              onChange={(e) => void update({ default_embedding: e.target.value })}
              className="w-full rounded-lg border border-border/70 bg-bg-input px-3 py-2 text-[13px] text-text-primary"
            >
              <option value="">Platform default</option>
              {embeddingModels.map((m) => (
                <option key={m.slug} value={m.slug}>
                  {m.display_name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h3 className="text-[13px] font-semibold text-text-heading">Allowed chat models</h3>
          <p className="text-[11.5px] text-text-muted">
            Agents can only be assigned models you allow here. Leave all unselected to allow every
            available model.
          </p>
        </div>
        <div className="space-y-2">
          {chatModels.map((m) => {
            const on = allowed.length === 0 || allowed.includes(m.slug)
            const explicit = allowed.includes(m.slug)
            return (
              <div
                key={m.slug}
                className="flex items-center justify-between gap-3 rounded-lg border border-border/55 bg-bg-surface/60 px-3.5 py-2.5"
              >
                <div>
                  <p className="text-[13px] font-medium text-text-heading">{m.display_name}</p>
                  <p className="text-[11px] text-text-muted">
                    {m.provider} · in {pricePerMtok(m.input_cost_per_mtok_cents)} · out{' '}
                    {pricePerMtok(m.output_cost_per_mtok_cents)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => toggleAllowed(m.slug)}
                  disabled={busy}
                  className={`rounded-full border px-3 py-1 text-[11.5px] font-medium transition-colors disabled:opacity-50 ${
                    explicit
                      ? 'border-accent/50 bg-accent/10 text-accent'
                      : on
                        ? 'border-border/60 bg-bg-surface text-text-muted'
                        : 'border-border/60 bg-bg-surface text-text-muted'
                  }`}
                >
                  {explicit ? 'Allowed' : on ? 'Allowed (all)' : 'Blocked'}
                </button>
              </div>
            )
          })}
        </div>
      </section>

      {isStaff ? <StaffCatalogAdmin token={token} /> : null}
    </PageContent>
  )
}

function StaffCatalogAdmin({ token }: { token: string | null }) {
  const [models, setModels] = useState<CatalogModel[]>([])
  const [keys, setKeys] = useState<PlatformKeysPayload | null>(null)
  const [markupDraft, setMarkupDraft] = useState('')
  const [keyDrafts, setKeyDrafts] = useState<Record<LlmProvider, string>>({ anthropic: '', openai: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!token) return
    try {
      const [m, k] = await Promise.all([bokitoStaffListModels(token), bokitoStaffGetPlatformKeys(token)])
      setModels(m.items)
      setKeys(k)
      setMarkupDraft(String(k.markup ?? ''))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load staff catalog.')
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  const toggleEnabled = async (model: CatalogModel) => {
    if (!token || !model.id) return
    setBusy(true)
    try {
      await bokitoStaffUpsertModel(token, { enabled: !model.enabled }, model.id)
      await load()
    } finally {
      setBusy(false)
    }
  }

  const saveKey = async (provider: LlmProvider) => {
    const value = keyDrafts[provider].trim()
    if (!token || !value) return
    setBusy(true)
    try {
      const next = await bokitoStaffSetPlatformKey(token, provider, value)
      setKeys(next)
      setKeyDrafts((prev) => ({ ...prev, [provider]: '' }))
    } finally {
      setBusy(false)
    }
  }

  const removeKey = async (provider: LlmProvider) => {
    if (!token) return
    setBusy(true)
    try {
      const next = await bokitoStaffDeletePlatformKey(token, provider)
      setKeys(next)
    } finally {
      setBusy(false)
    }
  }

  const saveMarkup = async () => {
    if (!token) return
    const value = Number(markupDraft)
    if (!Number.isFinite(value) || value < 1) {
      setError('Markup must be at least 1.0')
      return
    }
    setBusy(true)
    try {
      await bokitoStaffSetMarkup(token, value)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-4 rounded-xl border border-accent/30 bg-accent/[0.03] p-4">
      <div className="flex items-center gap-2">
        <ShieldCheck size={16} className="text-accent" />
        <h3 className="text-[13px] font-semibold text-text-heading">Platform administration (staff)</h3>
      </div>
      {error ? <p className="text-[12px] text-status-error">{error}</p> : null}

      <div className="space-y-2">
        <p className="text-[11.5px] font-medium text-text-muted">Catalog</p>
        {models.map((m) => (
          <div
            key={m.slug}
            className="flex items-center justify-between gap-3 rounded-lg border border-border/55 bg-bg-surface/70 px-3.5 py-2.5"
          >
            <div>
              <p className="text-[13px] font-medium text-text-heading">
                {m.display_name}{' '}
                <span className="text-[11px] text-text-muted">({m.slug} · {m.kind})</span>
              </p>
              <p className="text-[11px] text-text-muted">
                {m.provider} · {m.model_id} · in {pricePerMtok(m.input_cost_per_mtok_cents)} · out{' '}
                {pricePerMtok(m.output_cost_per_mtok_cents)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void toggleEnabled(m)}
              disabled={busy}
              className={`rounded-full border px-3 py-1 text-[11.5px] font-medium transition-colors disabled:opacity-50 ${
                m.enabled
                  ? 'border-status-success/40 bg-status-success/10 text-status-success'
                  : 'border-border/60 bg-bg-surface text-text-muted'
              }`}
            >
              {m.enabled ? 'Enabled' : 'Disabled'}
            </button>
          </div>
        ))}
      </div>

      <div className="space-y-3">
        <p className="text-[11.5px] font-medium text-text-muted">Bokito fallback keys (billable to tenants)</p>
        {(['anthropic', 'openai'] as const).map((provider) => {
          const ps = keys?.providers.find((p) => p.provider === provider)
          return (
            <div key={provider} className="flex flex-wrap items-center gap-2">
              <span className="w-24 text-[12.5px] text-text-secondary">{provider}</span>
              <input
                type="password"
                autoComplete="off"
                value={keyDrafts[provider]}
                onChange={(e) => setKeyDrafts((prev) => ({ ...prev, [provider]: e.target.value }))}
                placeholder={ps?.is_set ? `Set ····${ps.last4} — replace` : 'Enter platform key'}
                className="min-w-[240px] flex-1 rounded-lg border border-border/70 bg-bg-input px-3 py-2 text-[13px] text-text-primary"
              />
              <button
                type="button"
                onClick={() => void saveKey(provider)}
                disabled={busy || !keyDrafts[provider].trim()}
                className="rounded-lg bg-accent px-3.5 py-2 text-[12.5px] font-medium text-white hover:bg-accent-hover disabled:opacity-50"
              >
                Save
              </button>
              {ps?.is_set ? (
                <button
                  type="button"
                  onClick={() => void removeKey(provider)}
                  disabled={busy}
                  className="rounded-lg border border-border/70 px-3 py-2 text-[12.5px] text-text-secondary hover:text-status-error disabled:opacity-50"
                >
                  Remove
                </button>
              ) : null}
            </div>
          )
        })}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1.5">
          <span className="text-[11.5px] font-medium text-text-muted">Token resale markup (x)</span>
          <input
            type="number"
            step="0.05"
            min="1"
            value={markupDraft}
            onChange={(e) => setMarkupDraft(e.target.value)}
            className="w-32 rounded-lg border border-border/70 bg-bg-input px-3 py-2 text-[13px] text-text-primary"
          />
        </label>
        <button
          type="button"
          onClick={() => void saveMarkup()}
          disabled={busy}
          className="rounded-lg bg-accent px-3.5 py-2 text-[12.5px] font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          Save markup
        </button>
      </div>
    </section>
  )
}
