import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../context/AuthContext'
import { filtersetPlainLabel, predictFiltersetParent } from '../../lib/folder-filter-tree'
import { normalizeHashtag, stripHash } from '../../lib/hashtag'
import { listProjects, type ProjectRow } from '../../lib/projects-api'
import { listSignalTags, type SignalTag } from '../../lib/signals-api'
import { formatApiErrorMessage } from './ApiErrorBanner'
import { Button } from './button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog'
import { HashtagMark } from './HashtagMark'
import { TagChipInput, type TagChip } from './TagChipInput'
import { TagPill } from './TagPill'

export type TagSetOption = {
  key: string
  label: string
  tagNames: string[]
  viaContact?: boolean
  isCategory?: boolean
  isSavedMap?: boolean
  tagId?: string
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** `folder` = filterset only. `thread` = free tags + maps; action tags via onPickAction. */
  mode: 'folder' | 'thread'
  title: string
  description: string
  confirmLabel: string
  appliedNames?: string[]
  /**
   * Tags locked from a broader map / contact — shown as read-only chips and
   * always included in the confirmed set.
   */
  inheritedNames?: string[]
  /**
   * When set (folder create/edit under a parent), these tags stay locked and
   * are merged into the confirm payload. Alias of inheritedNames for folder UX.
   */
  lockedNames?: string[]
  initialSelected?: string[]
  hideActionTags?: boolean
  /** Show live "comes under …" for folder create from root. */
  showParentPreview?: boolean
  onConfirm: (tagNames: string[]) => Promise<void>
  onPickAction?: (tagId: string, name: string) => void
  onCreateChoice?: (name: string) => void
}

/**
 * Shared multi-select tag cloud: selected labels live as chips in the search
 * field (type after them); the cloud below discovers or creates labels.
 */
export function TagSetPicker({
  open,
  onOpenChange,
  mode,
  title,
  description,
  confirmLabel,
  appliedNames = [],
  inheritedNames = [],
  lockedNames = [],
  initialSelected = [],
  hideActionTags,
  showParentPreview = false,
  onConfirm,
  onPickAction,
  onCreateChoice,
}: Props) {
  const { t } = useTranslation('communication')
  const { token } = useAuth()
  const [query, setQuery] = useState('')
  const [registry, setRegistry] = useState<SignalTag[]>([])
  const [savedMaps, setSavedMaps] = useState<ProjectRow[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [seedKey, setSeedKey] = useState(0)

  const blockAction = hideActionTags ?? mode === 'folder'
  const locked = useMemo(() => {
    const names = [...inheritedNames, ...lockedNames].map((n) => normalizeHashtag(n)).filter(Boolean)
    return [...new Set(names)]
  }, [inheritedNames, lockedNames])
  const lockedSet = useMemo(() => new Set(locked), [locked])

  useEffect(() => {
    if (!open) return
    setQuery('')
    const lockedNow = new Set(
      [...inheritedNames, ...lockedNames].map((n) => normalizeHashtag(n)).filter(Boolean),
    )
    // Own tags only when locked parent tags are provided; else full initial set.
    const seed = initialSelected
      .map((n) => normalizeHashtag(n))
      .filter(Boolean)
      .filter((n) => !lockedNow.has(n))
    setSelected(seed)
    setSeedKey((k) => k + 1)
    if (!token) return
    let cancelled = false
    setLoading(true)
    void Promise.all([listSignalTags(token), listProjects().catch(() => [])])
      .then(([rows, maps]) => {
        if (cancelled) return
        setRegistry(rows)
        setSavedMaps(maps)
      })
      .catch(() => {
        if (!cancelled) {
          setRegistry([])
          setSavedMaps([])
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-seed only when dialog opens
  }, [open, token])

  const normalized = normalizeHashtag(query)
  const applied = useMemo(() => new Set(appliedNames.map((n) => normalizeHashtag(n))), [appliedNames])
  const inherited = lockedSet
  const selectedSet = useMemo(() => new Set(selected), [selected])
  const fullSelection = useMemo(() => {
    const out: string[] = []
    const seen = new Set<string>()
    for (const name of [...locked, ...selected]) {
      if (seen.has(name)) continue
      seen.add(name)
      out.push(name)
    }
    return out
  }, [locked, selected])

  const parentPreview = useMemo(() => {
    if (!showParentPreview || mode !== 'folder' || fullSelection.length === 0) return null
    return predictFiltersetParent(fullSelection, savedMaps)
  }, [fullSelection, mode, savedMaps, showParentPreview])

  const options = useMemo(() => {
    const q = normalized
    const out: TagSetOption[] = []
    // Saved maps: thread always; folder mode as a separate “add this set” shortcut.
    for (const map of savedMaps) {
      const names = (map.tag_names ?? []).map((n) => normalizeHashtag(n)).filter(Boolean)
      if (!names.length) continue
      const label = filtersetPlainLabel(names)
      if (q && !names.some((name) => name.includes(q)) && !label.toLowerCase().includes(q)) continue
      out.push({
        key: `map-${map.id}`,
        label,
        tagNames: names,
        viaContact: names.some((name) => inherited.has(name)),
        isSavedMap: true,
      })
    }
    for (const row of registry) {
      if (row.isCategory) {
        if (blockAction) continue
        if (q && !row.name.includes(q) && !row.description.toLowerCase().includes(q)) continue
        out.push({
          key: `cat-${row.id}`,
          label: row.name,
          tagNames: [row.name],
          viaContact: inherited.has(row.name),
          isCategory: true,
          tagId: row.id,
        })
        continue
      }
      if (q && !row.name.includes(q) && !row.description.toLowerCase().includes(q)) continue
      out.push({
        key: `tag-${row.id}`,
        label: row.name,
        tagNames: [row.name],
        viaContact: inherited.has(row.name),
      })
    }
    return out.sort((a, b) => {
      if (a.isSavedMap !== b.isSavedMap) return a.isSavedMap ? -1 : 1
      if (a.isCategory !== b.isCategory) return a.isCategory ? -1 : 1
      return a.label.localeCompare(b.label)
    })
  }, [registry, savedMaps, normalized, inherited, blockAction])

  const exactMatch = registry.find((row) => row.name === normalized) ?? null
  const isNewName = Boolean(normalized) && !exactMatch && !selectedSet.has(normalized)

  const toggleNames = (names: string[]) => {
    const clean = names.map((n) => normalizeHashtag(n)).filter(Boolean)
    if (!clean.length) return
    setSelected((prev) => {
      const next = new Set(prev)
      const allIn = clean.every((n) => next.has(n) || applied.has(n) || inherited.has(n))
      if (allIn) {
        for (const n of clean) {
          if (!applied.has(n) && !inherited.has(n)) next.delete(n)
        }
      } else {
        for (const n of clean) {
          if (!applied.has(n) && !inherited.has(n)) next.add(n)
        }
      }
      return [...next]
    })
  }

  const pickOption = (row: TagSetOption) => {
    if (row.isCategory && row.tagId && onPickAction) {
      onPickAction(row.tagId, row.tagNames[0] ?? '')
      return
    }
    toggleNames(row.tagNames)
  }

  const addDraft = () => {
    if (!normalized) return
    if (exactMatch?.isCategory && onPickAction) {
      onPickAction(exactMatch.id, exactMatch.name)
      return
    }
    if (exactMatch) {
      toggleNames([exactMatch.name])
      setQuery('')
      return
    }
    if (onCreateChoice && mode === 'thread') {
      onCreateChoice(normalized)
      return
    }
    toggleNames([normalized])
    setQuery('')
  }

  const confirm = async () => {
    // Folder label edit may clear all labels (place-only folder).
    if (mode !== 'folder' && !fullSelection.length) return
    // Creating under a locked parent requires at least one extra tag.
    if (locked.length > 0 && selected.filter((n) => !applied.has(n)).length === 0) return
    setBusy(true)
    try {
      await onConfirm(fullSelection)
      onOpenChange(false)
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('tags.createError')))
    } finally {
      setBusy(false)
    }
  }

  const pendingOnly = selected.filter((n) => !applied.has(n) && !lockedSet.has(n))
  const canConfirm =
    fullSelection.length > 0 && (locked.length === 0 ? pendingOnly.length > 0 || selected.length > 0 : pendingOnly.length > 0)
  // Folder mode: allow save with zero labels, or when selection differs from initial.
  const editReady =
    mode === 'folder' && locked.length === 0
      ? true
      : canConfirm

  const mapOptions = options.filter((row) => row.isSavedMap)
  const tagOptions = options.filter((row) => !row.isSavedMap)

  const inputChips: TagChip[] = [
    ...locked.map((name) => ({
      name,
      tone: 'set' as const,
      locked: true,
      title: t('tags.lockedFromParent', {
        defaultValue: 'Inherited from the broader map — always required',
      }),
    })),
    ...pendingOnly.map((name) => ({ name, tone: 'free' as const, title: name })),
  ]

  const removeChip = (name: string) => {
    setSelected((prev) => prev.filter((n) => n !== name))
  }

  const renderOption = (row: TagSetOption) => {
    const allApplied =
      !row.isCategory && row.tagNames.every((name) => applied.has(name) || inherited.has(name))
    const allSelected =
      !row.isCategory &&
      row.tagNames.every((name) => selectedSet.has(name) || applied.has(name) || inherited.has(name))
    const tone = row.isCategory ? 'action' : row.isSavedMap ? 'set' : 'free'
    return (
      <TagPill
        key={row.key}
        names={row.tagNames}
        tone={tone}
        size="md"
        selected={allSelected && !allApplied}
        applied={allApplied}
        title={
          row.viaContact
            ? t('tags.viaContact')
            : row.isCategory
              ? t('tags.actionTag')
              : row.isSavedMap
                ? t('tags.savedMap', { defaultValue: 'Saved map' })
                : t('tags.freeHashtag')
        }
        onClick={
          allApplied
            ? undefined
            : () => {
                pickOption(row)
                if (!row.isCategory) setQuery('')
              }
        }
        disabled={busy}
        className="transition-transform duration-150 hover:-translate-y-px active:scale-[0.98]"
      >
        <span className="inline-flex min-w-0 items-center gap-2">
          <HashtagMark category={row.isCategory} />
          <span className="min-w-0 truncate">{row.label}</span>
          {allSelected && !allApplied ? (
            <Check size={13} className="shrink-0 text-accent" aria-hidden />
          ) : null}
          {row.viaContact ? (
            <span className="text-2xs text-text-muted">{t('tags.viaContact')}</span>
          ) : null}
        </span>
      </TagPill>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg gap-4" data-testid="tag-set-picker" key={seedKey}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <TagChipInput
          chips={inputChips}
          value={query}
          onChange={(next) => setQuery(stripHash(next))}
          onSubmit={addDraft}
          onRemove={removeChip}
          disabled={busy}
          autoFocus
          placeholder={t('tags.searchPlaceholder')}
          aria-label={t('tags.searchPlaceholder')}
        />

        {mode === 'folder' && fullSelection.length > 0 ? (
          <p className="text-xs text-text-muted" data-testid="tag-set-preview">
            {t('tags.filtersetPreview', {
              defaultValue: 'Labels: {{set}}',
              set: filtersetPlainLabel(fullSelection),
            })}
            {parentPreview ? (
              <>
                {' · '}
                {t('tags.comesUnder', {
                  defaultValue: 'Comes under {{parent}}',
                  parent: filtersetPlainLabel(parentPreview.tag_names),
                })}
              </>
            ) : showParentPreview ? (
              <>
                {' · '}
                {t('tags.comesUnderRoot', { defaultValue: 'Top-level folder' })}
              </>
            ) : null}
          </p>
        ) : null}

        <div className="max-h-72 space-y-3 overflow-y-auto pr-0.5">
          {loading ? (
            <p className="px-1 py-3 text-xs text-text-muted">{t('tags.busy')}</p>
          ) : options.length === 0 && !isNewName ? (
            <p className="px-1 py-3 text-xs text-text-muted">{t('tags.noMatches')}</p>
          ) : (
            <>
              {mode === 'folder' && mapOptions.length > 0 ? (
                <div className="space-y-1.5">
                  <p className="px-0.5 text-2xs font-medium uppercase tracking-wide text-text-muted">
                    {t('tags.savedMaps', { defaultValue: 'Saved folders' })}
                  </p>
                  <div className="flex flex-wrap gap-2">{mapOptions.map(renderOption)}</div>
                </div>
              ) : null}
              <div className="space-y-1.5">
                {mode === 'folder' && mapOptions.length > 0 ? (
                  <p className="px-0.5 text-2xs font-medium uppercase tracking-wide text-text-muted">
                    {t('tags.tagsSection', { defaultValue: 'Labels' })}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {(mode === 'folder' ? tagOptions : options).map(renderOption)}
                  {isNewName ? (
                    <TagPill
                      names={normalized}
                      tone="free"
                      size="md"
                      selected={selectedSet.has(normalized)}
                      onClick={() => {
                        if (mode === 'thread' && onCreateChoice) onCreateChoice(normalized)
                        else {
                          toggleNames([normalized])
                          setQuery('')
                        }
                      }}
                      disabled={busy}
                      className="border border-dashed border-border/70 bg-transparent transition-transform duration-150 hover:-translate-y-px"
                    />
                  ) : null}
                </div>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            {t('tags.cancel')}
          </Button>
          <Button type="button" disabled={busy || !editReady} onClick={() => void confirm()}>
            {busy ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
            {confirmLabel}
            {pendingOnly.length > 0 ? (
              <span className="ml-1.5 rounded-md bg-bg-surface/25 px-1.5 py-px text-2xs tabular-nums">
                {pendingOnly.length}
              </span>
            ) : null}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
