import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { normalizeHashtag, stripHash } from '../../lib/hashtag'
import { TagPill } from '../ui/TagPill'

type Tag = { id?: string; name: string }

export function OwnerTagsField({
  tags,
  inherited = [],
  onChange,
  disabled,
  inheritedLabel,
}: {
  tags: Tag[]
  inherited?: Tag[]
  onChange: (names: string[]) => void
  disabled?: boolean
  inheritedLabel?: string
}) {
  const { t } = useTranslation('communication')
  const [draft, setDraft] = useState('')
  const names = useMemo(() => tags.map((tag) => tag.name), [tags])

  const add = () => {
    const name = normalizeHashtag(stripHash(draft))
    if (!name || names.includes(name)) {
      setDraft('')
      return
    }
    onChange([...names, name])
    setDraft('')
  }

  return (
    <div className="space-y-1.5" data-testid="owner-tags">
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((tag) => (
          <TagPill
            key={tag.id ?? tag.name}
            names={tag.name}
            tone="free"
            size="sm"
            disabled={disabled}
            onRemove={() => onChange(names.filter((name) => name !== tag.name))}
            removeLabel={t('tags.remove', { tag: tag.name })}
            removeAlwaysVisible
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
      </div>
      <div className="flex items-center gap-1.5">
        <input
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
          className="h-7 min-w-0 flex-1 rounded-md border border-border bg-bg-input px-2 text-xs"
        />
        <button
          type="button"
          disabled={disabled || !normalizeHashtag(stripHash(draft))}
          onClick={add}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs disabled:opacity-40"
        >
          <Plus size={12} />
          {t('tags.add')}
        </button>
      </div>
    </div>
  )
}
