import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { PageContent } from '../components/layout/PageContent'
import { SettingsSection } from '../components/layout/SettingsSection'
import { BotOrbAvatar } from '../components/ui/BotOrbAvatar'
import { Button } from '../components/ui/button'
import { LoadingBlock } from '../components/ui/loading-block'
import { Card, CardContent } from '../components/ui/card'
import { SearchField } from '../components/ui/search-field'
import { DEFAULT_BOT_ORB_COLOR, DEFAULT_BOT_ORB_SHAPE } from '../lib/bot-orb-shapes'
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
    <PageContent width="lg" className="space-y-4 py-1">
      <Card>
        <CardContent className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
          <BotOrbAvatar
            shape={DEFAULT_BOT_ORB_SHAPE}
            color={DEFAULT_BOT_ORB_COLOR}
            size={72}
            decorative
            label={t('assistantSettings.title')}
          />
          <div className="min-w-0 flex-1 space-y-3">
            <p className="text-sm leading-5 text-text-secondary">{t('assistantSettings.body')}</p>
            <Button size="sm" onClick={() => startAssistantThread()}>
              {t('assistantSettings.talkCta')}
            </Button>
          </div>
        </CardContent>
      </Card>
      <SettingsSection
        title={t('assistantSettings.memoryTitle')}
        description={t('assistantSettings.memoryHint')}
        actions={
          entries && entries.length > 0 ? (
            <Button size="sm" variant="secondary" disabled={clearing} onClick={() => void clearAll()}>
              {t('assistantSettings.clearMemory')}
            </Button>
          ) : null
        }
      >
        {entries && entries.length > 3 ? (
          <SearchField
            value={memoryQuery}
            onChange={setMemoryQuery}
            size="sm"
            placeholder={t('assistantSettings.memorySearch')}
            aria-label={t('assistantSettings.memorySearch')}
            className="mb-3 max-w-sm"
          />
        ) : null}
        {loading ? (
          <LoadingBlock variant="skeleton" rows={3} />
        ) : !entries?.length ? (
          <p className="text-sm text-text-secondary">{t('assistantSettings.memoryEmpty')}</p>
        ) : visibleEntries.length === 0 ? (
          <p className="text-sm text-text-secondary">{t('assistantSettings.memoryNoMatch')}</p>
        ) : (
          <ul className="space-y-2">
            {visibleEntries.map((entry) => (
              <li
                key={entry.key}
                className="flex items-start justify-between gap-3 rounded-md border border-border/60 bg-bg-elevated px-3 py-2.5"
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
      </SettingsSection>
    </PageContent>
  )
}
