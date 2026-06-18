import { useCallback, useEffect, useState } from 'react'
import { Check, KeyRound, Loader2, Trash2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { PageContent } from '../components/layout/PageContent'
import {
  bokitoDeleteLlmKey,
  bokitoGetLlmKeys,
  bokitoSetLlmKey,
  type LlmKeysStatus,
  type LlmProvider,
} from '../lib/bokito-api'

type ProviderMeta = {
  provider: LlmProvider
  label: string
  description: string
  placeholder: string
}

const PROVIDERS: ProviderMeta[] = [
  {
    provider: 'anthropic',
    label: 'Anthropic (chat)',
    description: 'Used for agent chat and reasoning. Adding a key switches this workspace to live chat.',
    placeholder: 'sk-ant-...',
  },
  {
    provider: 'openai',
    label: 'OpenAI (embeddings)',
    description: 'Used for knowledge-base retrieval. Adding a key enables live embeddings for this workspace.',
    placeholder: 'sk-...',
  },
]

/**
 * Per-tenant LLM API key management. Keys are encrypted server-side and only
 * the last four characters are ever shown back. Admin/owner only.
 */
export default function LlmKeysSettings() {
  const { token } = useAuth()
  const [status, setStatus] = useState<LlmKeysStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [drafts, setDrafts] = useState<Record<LlmProvider, string>>({ anthropic: '', openai: '' })
  const [busy, setBusy] = useState<LlmProvider | null>(null)
  const [saved, setSaved] = useState<LlmProvider | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!token) return
      setLoading(true)
      try {
        const data = await bokitoGetLlmKeys(token)
        if (!cancelled) setStatus(data)
      } catch {
        if (!cancelled) setError('Could not load LLM keys.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [token])

  const saveKey = useCallback(
    async (provider: LlmProvider) => {
      const value = drafts[provider].trim()
      if (!token || busy || !value) return
      setBusy(provider)
      setSaved(null)
      setError(null)
      try {
        const updated = await bokitoSetLlmKey(token, provider, value)
        setStatus(updated)
        setDrafts((prev) => ({ ...prev, [provider]: '' }))
        setSaved(provider)
        window.setTimeout(() => setSaved(null), 2500)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save key.')
      } finally {
        setBusy(null)
      }
    },
    [token, busy, drafts],
  )

  const removeKey = useCallback(
    async (provider: LlmProvider) => {
      if (!token || busy) return
      setBusy(provider)
      setSaved(null)
      setError(null)
      try {
        const updated = await bokitoDeleteLlmKey(token, provider)
        setStatus(updated)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not remove key.')
      } finally {
        setBusy(null)
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

  const statusFor = (provider: LlmProvider) => status?.providers.find((p) => p.provider === provider)

  return (
    <PageContent width="lg" className="space-y-6 py-1">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-bg-surface text-accent">
          <KeyRound size={18} />
        </span>
        <div>
          <h2 className="text-[15px] font-semibold text-text-heading">AI keys</h2>
          <p className="text-[12.5px] text-text-muted">
            Bring your own LLM keys for this workspace, or use Bokito platform models (Anthropic via
            Bokito) when no tenant key is set. Keys you add are encrypted and never shown again.
          </p>
        </div>
      </div>

      {status ? (
        <div className="flex flex-wrap gap-2 text-[11.5px]">
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 ${
              status.chat_mode === 'live'
                ? 'border-status-success/40 bg-status-success/10 text-status-success'
                : 'border-border/60 bg-bg-surface text-text-muted'
            }`}
          >
            Chat: {status.chat_mode === 'live' ? 'Live' : 'Mock'}
            {status.chat_mode === 'live' && status.chat_key_source === 'platform'
              ? ' (Bokito platform)'
              : status.chat_mode === 'live' && status.chat_key_source === 'tenant'
                ? ' (your key)'
                : ''}
          </span>
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 ${
              status.embeddings_mode === 'live'
                ? 'border-status-success/40 bg-status-success/10 text-status-success'
                : 'border-border/60 bg-bg-surface text-text-muted'
            }`}
          >
            Embeddings: {status.embeddings_mode === 'live' ? 'Live' : 'Mock'}
            {status.embeddings_mode === 'live' && status.embeddings_key_source === 'platform'
              ? ' (Bokito platform)'
              : status.embeddings_mode === 'live' && status.embeddings_key_source === 'tenant'
                ? ' (your key)'
                : ''}
          </span>
        </div>
      ) : null}

      {error ? <p className="text-[12px] text-status-error">{error}</p> : null}

      <div className="space-y-4">
        {PROVIDERS.map((meta) => {
          const ps = statusFor(meta.provider)
          const isBusy = busy === meta.provider
          return (
            <div
              key={meta.provider}
              className="space-y-3 rounded-xl border border-border/60 bg-bg-surface/60 p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-[13.5px] font-medium text-text-heading">{meta.label}</h3>
                  <p className="text-[11.5px] text-text-muted">{meta.description}</p>
                </div>
                {ps?.is_set ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-status-success/40 bg-status-success/10 px-2.5 py-1 text-[11px] text-status-success">
                    Set ····{ps.last4}
                  </span>
                ) : status?.chat_key_source === 'platform' && meta.provider === 'anthropic' ? (
                  <span className="rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1 text-[11px] text-accent">
                    Bokito platform
                  </span>
                ) : status?.embeddings_key_source === 'platform' && meta.provider === 'openai' ? (
                  <span className="rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1 text-[11px] text-accent">
                    Bokito platform
                  </span>
                ) : (
                  <span className="rounded-full border border-border/60 bg-bg-surface px-2.5 py-1 text-[11px] text-text-muted">
                    Not set
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="password"
                  autoComplete="off"
                  value={drafts[meta.provider]}
                  onChange={(e) =>
                    setDrafts((prev) => ({ ...prev, [meta.provider]: e.target.value }))
                  }
                  placeholder={ps?.is_set ? 'Enter a new key to replace' : meta.placeholder}
                  className="min-w-[260px] flex-1 rounded-lg border border-border/70 bg-bg-input px-3 py-2 text-[13px] text-text-primary focus:outline-none focus:ring-1 focus:ring-accent/50"
                />
                <button
                  type="button"
                  onClick={() => void saveKey(meta.provider)}
                  disabled={isBusy || !drafts[meta.provider].trim()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-[12.5px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
                >
                  {isBusy ? <Loader2 size={13} className="animate-spin" /> : null}
                  Save
                </button>
                {ps?.is_set ? (
                  <button
                    type="button"
                    onClick={() => void removeKey(meta.provider)}
                    disabled={isBusy}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 px-3 py-2 text-[12.5px] text-text-secondary transition-colors hover:bg-bg-hover/60 hover:text-status-error disabled:opacity-50"
                  >
                    <Trash2 size={13} /> Remove
                  </button>
                ) : null}
                {saved === meta.provider ? (
                  <span className="inline-flex items-center gap-1 text-[12px] text-status-success">
                    <Check size={13} /> Saved
                  </span>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>

      <p className="text-[11px] text-text-muted">
        Keys are encrypted at rest. Removing your key falls back to the Bokito platform model when
        configured, otherwise mock mode.
      </p>
    </PageContent>
  )
}
