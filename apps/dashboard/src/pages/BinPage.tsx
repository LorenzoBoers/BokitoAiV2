import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  Brain,
  Building2,
  FolderKanban,
  Layers,
  LayoutTemplate,
  ListFilter,
  MessageSquare,
  MessageSquareText,
  UserRound,
  Users,
  Workflow,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { PageContent } from '../components/layout/PageContent'
import ContentHeader from '../components/shell/ContentHeader'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { ApiErrorBanner, formatApiErrorMessage } from '../components/ui/ApiErrorBanner'
import {
  BIN_TYPES,
  emptyTrash,
  filterBinItems,
  getTrashSettings,
  listTrash,
  purgeTrashItem,
  restoreTrashItem,
  type TrashItem,
  type TrashSettings,
} from '../lib/trash-api'

/** Icons match shell / entity pages so bin chips stay recognizable. */
const BIN_TYPE_ICONS: Record<(typeof BIN_TYPES)[number], LucideIcon> = {
  conversation: MessageSquare,
  project: FolderKanban,
  canvas: LayoutTemplate,
  knowledge: Brain,
  contact: UserRound,
  company: Building2,
  playbook: Workflow,
  trigger: Zap,
  team: Users,
  inbox_rule: ListFilter,
  saved_reply: MessageSquareText,
}

function iconForBinType(resourceType: string): LucideIcon {
  if ((BIN_TYPES as readonly string[]).includes(resourceType)) {
    return BIN_TYPE_ICONS[resourceType as (typeof BIN_TYPES)[number]]
  }
  return Layers
}

export default function BinPage() {
  const { t, i18n } = useTranslation('nav')
  const [items, setItems] = useState<TrashItem[]>([])
  const [settings, setSettings] = useState<TrashSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [type, setType] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [list, nextSettings] = await Promise.all([
        listTrash(),
        getTrashSettings().catch(() => null),
      ])
      setItems(list.items)
      setSettings(nextSettings)
    } catch (err) {
      setError(formatApiErrorMessage(err, t('binPage.loadError')))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const visible = useMemo(() => filterBinItems(items, type, q), [items, type, q])
  const days = settings?.effective_days ?? 60

  const onRestore = async (id: string) => {
    setBusyId(id)
    try {
      await restoreTrashItem(id)
      toast.success(t('binPage.restored'))
      await load()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('binPage.restoreError')))
    } finally {
      setBusyId(null)
    }
  }

  const onPurge = async (id: string) => {
    if (!window.confirm(t('binPage.purgeConfirm'))) return
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
    const typed = window.prompt(t('binPage.emptyPrompt'))
    if (!typed) return
    setBusyId('empty')
    try {
      await emptyTrash(typed)
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
    return date.toLocaleString(i18n.language === 'nl' ? 'nl-NL' : 'en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  }

  return (
    <PageContent width="md" className="space-y-6">
      <ContentHeader title={t('binPage.title')} subtitle={t('binPage.subtitle')} />
      {error ? <ApiErrorBanner message={error} onRetry={() => void load()} /> : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${type === null ? 'border-accent text-accent' : 'border-border/60 text-text-muted'}`}
          onClick={() => setType(null)}
        >
          <Layers size={12} aria-hidden />
          {t('binPage.allTypes')}
        </button>
        {BIN_TYPES.map((chip) => {
          const Icon = BIN_TYPE_ICONS[chip]
          return (
            <button
              key={chip}
              type="button"
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${type === chip ? 'border-accent text-accent' : 'border-border/60 text-text-muted'}`}
              onClick={() => setType(chip)}
            >
              <Icon size={12} aria-hidden />
              {t(`binPage.types.${chip}`)}
            </button>
          )
        })}
      </div>

      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('binPage.search')}
      />

      {loading ? (
        <p className="text-sm text-text-muted">{t('binPage.loading')}</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-text-muted">{t('binPage.empty')}</p>
      ) : (
        <ul className="divide-y divide-border/60 rounded-lg border border-border/60">
          {visible.map((row) => {
            const TypeIcon = iconForBinType(row.resource_type)
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

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
        <p className="text-xs text-text-muted">{t('binPage.retention', { days })}</p>
        <Button variant="outline" size="sm" disabled={busyId === 'empty' || items.length === 0} onClick={() => void onEmpty()}>
          {t('binPage.emptyBin')}
        </Button>
      </div>
    </PageContent>
  )
}
