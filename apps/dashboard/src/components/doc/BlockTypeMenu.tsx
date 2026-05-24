import { useState } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@radix-ui/react-dropdown-menu'
import {
  Heading1,
  Heading2,
  Heading3,
  ListOrdered,
  List,
  CheckSquare,
  Quote,
  Info,
  Minus,
  Code,
  Pilcrow,
  Type,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { DocBlockType } from '../../lib/doc-api'

interface BlockTypeMenuProps {
  value: DocBlockType
  onChange: (next: DocBlockType) => void
}

const TYPE_OPTIONS: Array<{
  value: DocBlockType
  icon: React.ComponentType<{ className?: string; size?: number }>
}> = [
  { value: 'paragraph', icon: Pilcrow },
  { value: 'heading_1', icon: Heading1 },
  { value: 'heading_2', icon: Heading2 },
  { value: 'heading_3', icon: Heading3 },
  { value: 'bullet_list_item', icon: List },
  { value: 'numbered_list_item', icon: ListOrdered },
  { value: 'to_do', icon: CheckSquare },
  { value: 'quote', icon: Quote },
  { value: 'callout', icon: Info },
  { value: 'code', icon: Code },
  { value: 'divider', icon: Minus },
]

export function BlockTypeMenu({ value, onChange }: BlockTypeMenuProps) {
  const { t } = useTranslation('nav')
  const [open, setOpen] = useState(false)
  const current = TYPE_OPTIONS.find((o) => o.value === value)
  const CurrentIcon = current?.icon ?? Type
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-7 items-center gap-1 rounded-md border border-border/60 bg-bg-surface px-2 text-xs text-text-secondary opacity-0 transition-opacity hover:bg-bg-hover group-hover:opacity-100 data-[state=open]:opacity-100"
          aria-label={t('project.doc.editor.changeBlockType')}
        >
          <CurrentIcon size={12} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        sideOffset={4}
        align="start"
        className="z-50 w-56 rounded-md border border-border/60 bg-bg-elevated p-1 shadow-lg"
      >
        {TYPE_OPTIONS.map((opt, i) => {
          const Icon = opt.icon
          const items = [
            <DropdownMenuItem
              key={opt.value}
              onSelect={() => onChange(opt.value)}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-text-primary outline-none focus:bg-bg-hover"
            >
              <Icon size={14} className="text-text-muted" />
              <span>{t(`project.doc.blockType.${opt.value}`)}</span>
            </DropdownMenuItem>,
          ]
          if (i === 0 || i === 4 || i === 7) {
            items.push(
              <DropdownMenuSeparator
                key={`sep-${opt.value}`}
                className="my-1 h-px bg-border/60"
              />,
            )
          }
          return items
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export const ALL_BLOCK_TYPES = TYPE_OPTIONS
