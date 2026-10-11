import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { PageContent } from '../components/layout/PageContent'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { useConfirm } from '../components/ui/confirm-dialog'
import { useAuth } from '../context/AuthContext'
import { appRoutes } from '../api/routes'
import { apiDelete, apiGet } from '../lib/api'
import { startAssistantThread } from '../lib/personal-assistant-widget'

type MemoryEntry = {
  key: string
  content: string
  updated_at: string | null
}

export default function MyAssistantSettings() {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const confirm = useConfirm()
  const [entries, setEntries] = useState<MemoryEntry[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [clearing, setClearing] = useState(false)
  const [memoryQuery, setMemoryQuery] = useState('')

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const data = await apiGet<{ entries: MemoryEntry[] }>(appRoutes.me.assistantMemory, token)
      setEntries(data.entries ?? [])
    } catch {
      setEntries([])
      toast.error(t('assistantSettings.loadError'))
    } finally {
      setLoading(false)
    }
  }, [token, t])

  useEffect(() => {
    void load()
  }, [load])

  const visibleEntries = useMemo(() => {
    const q = memoryQuery.trim().toLowerCase()
    const rows = entries ?? []
    if (!q) return rows
    return rows.filter((entry) => `${entry.key} ${entry.content}`.toLowerCase().includes(q))
  }, [entries, memoryQuery])

  const removeEntry = async (key: string) => {
    if (!token) return
    if (!(await confirm({ description: t('assistantSettings.forgetConfirm', { key }), destructive: true }))) return
    try {
      await apiDelete(appRoutes.me.assistantMemoryKey(key), token)
      setEntries((prev) => (prev ?? []).filter((e) => e.key !== key))
    } catch {
      toast.error(t('assistantSettings.saveError'))
    }
  }

  const clearAll = async () => {
    if (!token) return
    if (!(await confirm({ description: t('assistantSettings.clearConfirm'), destructive: true }))) return
    setClearing(true)
    try {
      await apiDelete(appRoutes.me.assistantMemory, token)
      setEntries([])
    } catch {
      toast.error(t('assistantSettings.saveError'))
    } finally {
      setClearing(false)
    }
  }

  return (
    <PageContent width="lg" className="space-y-6 py-1">
      <p className="text-sm text-text-secondary">{t('assistantSettings.body')}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => startAssistantThread()}>
          {t('assistantSettings.talkCta')}
        </Button>
      </div>
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium text-text-heading">{t('assistantSettings.memoryTitle')}</h3>
          {entries && entries.length > 0 ? (
            <Button size="sm" variant="secondary" disabled={clearing} onClick={() => void clearAll()}>
              {t('assistantSettings.clearMemory')}
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-text-muted">{t('assistantSettings.memoryHint')}</p>
        {entries && entries.length > 3 ? (
          <Input
            value={memoryQuery}
            onChange={(event) => setMemoryQuery(event.target.value)}
            placeholder={t('assistantSettings.memorySearch')}
            aria-label={t('assistantSettings.memorySearch')}
            className="h-8 max-w-sm"
          />
        ) : null}
        {loading ? (
          <p className="text-sm text-text-muted">{t('messengerPage.loading')}</p>
        ) : !entries?.length ? (
          <p className="text-sm text-text-secondary">{t('assistantSettings.memoryEmpty')}</p>
        ) : visibleEntries.length === 0 ? (
          <p className="text-sm text-text-secondary">{t('assistantSettings.memoryNoMatch')}</p>
        ) : (
          <ul className="space-y-2">
            {visibleEntries.map((entry) => (
              <li
                key={entry.key}
                className="flex items-start justify-between gap-3 rounded-lg border border-border/60 bg-bg-surface/60 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text-heading">{entry.key}</p>
                  <p className="mt-0.5 text-sm text-text-secondary">{entry.content}</p>
                  {entry.updated_at ? (
                    <p className="mt-1 text-xs text-text-muted">
                      {t('assistantSettings.updated', {
                        date: new Date(entry.updated_at).toLocaleString(),
                      })}
                    </p>
                  ) : null}
                </div>
                <Button size="sm" variant="secondary" onClick={() => void removeEntry(entry.key)}>
                  {t('assistantSettings.forget')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageContent>
  )
}
