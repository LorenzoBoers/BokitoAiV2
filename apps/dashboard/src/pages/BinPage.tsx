import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Layers, Trash2 } from 'lucide-react'
import { entityIcon } from '../lib/entity-icons'
import { restoredEntityPath } from '../lib/open-entity'
import { PageContent } from '../components/layout/PageContent'
import ContentHeader from '../components/shell/ContentHeader'
import { Button } from '../components/ui/button'
import { TrashRowsSkeleton } from '../components/ui/skeleton'
import { EmptyState } from '../components/ui/empty-state'
import { FilterChip, FilterChipRow } from '../components/ui/filter-chip'
import { SearchField } from '../components/ui/search-field'
import { useConfirm } from '../components/ui/confirm-dialog'
import { ApiErrorBanner, formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import { formatAppDate } from '../lib/app-locale'
import {
  BIN_TYPES,
  emptyTrash,
  getTrashSettings,
  listTrash,
  purgeTrashItem,
  restoreTrashItem,
  type TrashItem,
  type TrashSettings,
} from '../lib/trash-api'

export default function BinPage() {
  const { t, i18n } = useTranslation('nav')
  const navigate = useNavigate()
  const [items, setItems] = useState<TrashItem[]>([])
  const [settings, setSettings] = useState<TrashSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [type, setType] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [nextOffset, setNextOffset] = useState<number | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const confirm = useConfirm()

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQ(q.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [q])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [list, nextSettings] = await Promise.all([
        listTrash({
          ...(type ? { type } : {}),
          ...(debouncedQ ? { q: debouncedQ } : {}),
        }),
        getTrashSettings().catch(() => null),
      ])
      setItems(list.items)
      setNextOffset(list.next_offset)
      setSettings(nextSettings)
    } catch (err) {
      setError(formatApiErrorMessage(err, t('binPage.loadError')))
    } finally {
      setLoading(false)
    }
  }, [t, type, debouncedQ])

  const loadMore = async () => {
    if (nextOffset == null || loadingMore) return
    setLoadingMore(true)
    try {
      const list = await listTrash({
        ...(type ? { type } : {}),
        ...(debouncedQ ? { q: debouncedQ } : {}),
        cursor: nextOffset,
      })
      setItems((prev) => {
        const seen = new Set(prev.map((row) => row.id))
        return [...prev, ...list.items.filter((row) => !seen.has(row.id))]
      })
      setNextOffset(list.next_offset)
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('binPage.loadError')))
    } finally {
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    void load()
  }, [load])

  const days = settings?.effective_days ?? 60

  const onRestore = async (id: string) => {
    setBusyId(id)
    try {
      const restored = await restoreTrashItem(id)
      const openPath = restoredEntityPath(restored.resource_type, restored.resource_id, restored.restore_hint)
      toast.success(
        t('binPage.restored'),
        openPath ? { action: { label: t('binPage.openRestored'), onClick: () => navigate(openPath) } } : undefined,
      )
      await load()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('binPage.restoreError')))
    } finally {
      setBusyId(null)
    }
  }

  const onPurge = async (id: string) => {
    if (!(await confirm({ description: t('binPage.purgeConfirm'), destructive: true }))) return
    setBusyId(id)
    try {
      await purgeTrashItem(id)
      toast.success(t('binPage.purged'))
      await load()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('binPage.purgeError')))
    } finally {
      setBusyId(null)
    }
  }

  const onEmpty = async () => {
    const word = t('binPage.emptyWord')
    if (!(await confirm({
      description: t('binPage.emptyPrompt'),
      typeToConfirm: word,
      confirmLabel: t('binPage.emptyBin'),
      destructive: true,
    }))) return
    setBusyId('empty')
    try {
      await emptyTrash(word)
      toast.success(t('binPage.emptied'))
      await load()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('binPage.emptyError')))
    } finally {
      setBusyId(null)
    }
  }

  const formatWhen = (iso: string | null) => {
    if (!iso) return ''
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return iso
    return formatAppDate(date, i18n.language, { day: 'numeric', month: 'short', year: 'numeric' })
  }
  const filtered = Boolean(q.trim() || type)

  return (
    <PageContent width="md" className="space-y-6">
      <ContentHeader title={t('binPage.title')} subtitle={t('binPage.subtitle')} />
      {error ? <ApiErrorBanner message={error} onRetry={() => void load()} /> : null}

      <FilterChipRow>
        <FilterChip active={type === null} icon={Layers} onClick={() => setType(null)}>
          {t('binPage.allTypes')}
        </FilterChip>
        {BIN_TYPES.map((chip) => (
          <FilterChip
            key={chip}
            active={type === chip}
            icon={entityIcon(chip, Layers)}
            onClick={() => setType(chip)}
          >
            {t(`binPage.types.${chip}`)}
          </FilterChip>
        ))}
      </FilterChipRow>

      <SearchField value={q} onChange={setQ} placeholder={t('binPage.search')} />

      {loading ? (
        <TrashRowsSkeleton />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Trash2}
          size="sm"
          title={filtered ? t('binPage.emptySearch') : t('binPage.empty')}
          description={filtered ? undefined : t('binPage.emptyHint')}
          action={
            filtered ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setType(null)
                  setQ('')
                }}
              >
                {t('binPage.clearFilters')}
              </Button>
            ) : undefined
          }
          footer={
            <Link to="/docs/govern/privacy-security" className="text-xs text-text-muted hover:text-accent hover:underline">
              {t('binPage.docsLink')}
            </Link>
          }
        />
      ) : (
        <ul className="divide-y divide-border/60 rounded-lg border border-border">
          {items.map((row) => {
            const TypeIcon = entityIcon(row.resource_type, Layers)
            return (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="flex min-w-0 items-start gap-2.5">
                <TypeIcon
                  size={16}
                  className="mt-0.5 shrink-0 text-text-muted"
                  aria-hidden
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-text-heading">{row.title || t('binPage.untitled')}</p>
                  <p className="text-xs text-text-muted">
                    {t(`binPage.types.${row.resource_type}`, { defaultValue: row.resource_type })}
                    {' · '}
                    {t('binPage.deletedBy', { name: row.deleted_by_name || t('binPage.deletedByUnknown') })}
                    {' · '}
                    {t('binPage.purgeOn', { date: formatWhen(row.purge_after) })}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" disabled={busyId === row.id} onClick={() => void onRestore(row.id)}>
                  {t('binPage.restore')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-status-error hover:bg-status-error/10 hover:text-status-error"
                  disabled={busyId === row.id}
                  onClick={() => void onPurge(row.id)}
                >
                  {t('binPage.deleteForever')}
                </Button>
              </div>
            </li>
            )
          })}
        </ul>
      )}

      {nextOffset != null && !loading ? (
        <div className="flex justify-center">
          <Button size="sm" variant="secondary" disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? t('binPage.loadingMore') : t('binPage.loadMore')}
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <p className="text-xs text-text-muted">{t('binPage.retention', { days })}</p>
        <Button variant="secondary" size="sm" disabled={busyId === 'empty' || items.length === 0} onClick={() => void onEmpty()}>
          {t('binPage.emptyBin')}
        </Button>
      </div>
    </PageContent>
  )
}
