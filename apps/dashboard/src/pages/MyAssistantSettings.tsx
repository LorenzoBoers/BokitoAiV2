import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { PageContent } from '../components/layout/PageContent'
import { Button } from '../components/ui/button'
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
  const [entries, setEntries] = useState<MemoryEntry[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [clearing, setClearing] = useState(false)

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

  const removeEntry = async (key: string) => {
    if (!token) return
    try {
      await apiDelete(appRoutes.me.assistantMemoryKey(key), token)
      setEntries((prev) => (prev ?? []).filter((e) => e.key !== key))
    } catch {
      toast.error(t('assistantSettings.saveError'))
    }
  }

  const clearAll = async () => {
    if (!token) return
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
        {loading ? (
          <p className="text-sm text-text-muted">{t('messengerPage.loading')}</p>
        ) : !entries?.length ? (
          <p className="text-sm text-text-secondary">{t('assistantSettings.memoryEmpty')}</p>
        ) : (
          <ul className="space-y-2">
            {entries.map((entry) => (
              <li
                key={entry.key}
                className="flex items-start justify-between gap-3 rounded-lg border border-border/60 bg-bg-surface/60 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text-heading">{entry.key}</p>
                  <p className="mt-0.5 text-sm text-text-secondary">{entry.content}</p>
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
