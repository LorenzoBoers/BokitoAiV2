import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../ui/button'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { normalizeHashtag, stripHash } from '../../lib/hashtag'
import { TagPill } from '../ui/TagPill'
import { Input } from '../ui/input'

type Tag = { id?: string; name: string }

const COMPACT_VISIBLE = 3

export function OwnerTagsField({
  tags,
  inherited = [],
  onChange,
  disabled,
  inheritedLabel,
  /** Side-panel density: pills + add on demand, overflow +N. */
  compact = false,
}: {
  tags: Tag[]
  inherited?: Tag[]
  onChange: (names: string[]) => void
  disabled?: boolean
  inheritedLabel?: string
  compact?: boolean
}) {
  const { t } = useTranslation('communication')
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const names = useMemo(() => tags.map((tag) => tag.name), [tags])

  useEffect(() => {
    if (adding) inputRef.current?.focus()
  }, [adding])

  const add = () => {
    const name = normalizeHashtag(stripHash(draft))
    if (!name || names.includes(name)) {
      setDraft('')
      setAdding(false)
      return
    }
    onChange([...names, name])
    setDraft('')
    setAdding(false)
  }

  const cancelAdd = () => {
    setDraft('')
    setAdding(false)
  }

  const visibleTags = compact && !expanded ? tags.slice(0, COMPACT_VISIBLE) : tags
  const hiddenCount = compact && !expanded ? Math.max(0, tags.length - COMPACT_VISIBLE) : 0

  const pills = (
    <>
      {visibleTags.map((tag) => (
        <TagPill
          key={tag.id ?? tag.name}
          names={tag.name}
          tone="free"
          size="sm"
          disabled={disabled}
          onRemove={() => onChange(names.filter((name) => name !== tag.name))}
          removeLabel={t('tags.remove', { tag: tag.name })}
        />
      ))}
      {inherited.map((tag) => (
        <TagPill
          key={`via-${tag.id ?? tag.name}`}
          names={tag.name}
          tone="inherited"
          size="sm"
          title={inheritedLabel}
        />
      ))}
      {hiddenCount > 0 ? (
        <Button variant="ghost" size="xs"
          type="button"
          disabled={disabled}
          onClick={() => setExpanded(true)}
        >
          {t('tags.moreCount', { count: hiddenCount })}
        </Button>
      ) : null}
    </>
  )

  const canAdd = Boolean(normalizeHashtag(stripHash(draft)))

  if (compact) {
    return (
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5" data-testid="owner-tags">
        {pills}
        {adding ? (
          <>
            <Input
              ref={inputRef}
              value={draft}
              disabled={disabled}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  add()
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  cancelAdd()
                }
              }}
              onBlur={() => {
                if (!draft.trim()) cancelAdd()
              }}
              placeholder={t('tags.placeholder')}
              aria-label={t('contactPanel.tags')}
              className="h-6 w-[5.5rem] min-w-0 text-2xs"
            />
            <Button variant="ghost" size="iconSm"
              type="button"
              disabled={disabled || !canAdd}
              onClick={add}
              aria-label={t('tags.add')}
              title={t('tags.add')}
            >
              <Plus size={14} />
            </Button>
          </>
        ) : (
          <Button variant="ghost" size="iconSm"
            type="button"
            disabled={disabled}
            onClick={() => setAdding(true)}
            aria-label={t('tags.add')}
            title={t('tags.add')}
            className="ring-1 ring-inset ring-border/50"
          >
            <Plus size={14} />
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-1.5" data-testid="owner-tags">
      <div className="flex flex-wrap items-center gap-1.5">{pills}</div>
      <div className="flex items-center gap-1.5">
        <Input
          value={draft}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              add()
            }
          }}
          placeholder={t('tags.placeholder')}
          className="h-7 min-w-0 flex-1 text-xs"
        />
        <Button variant="secondary" size="xs"
          type="button"
          disabled={disabled || !canAdd}
          onClick={add}
        >
          <Plus size={14} />
          {t('tags.add')}
        </Button>
      </div>
    </div>
  )
}
