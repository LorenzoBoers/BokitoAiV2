import { useCallback } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useSidebarPrefs } from '../../context/SidebarPrefsContext'
import {
  MOVABLE_SECTIONS,
  type SidebarSection,
} from '../../lib/communication-sidebar-prefs'
import { SECTION_LABELS } from './MessagesHubNav'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'
import { Switch } from '../ui/switch'
import { cn } from '../../lib/utils'

type SectionTogglesProps = {
  section: SidebarSection
  label: string
  hidden: boolean
  collapsed: boolean
  onHiddenChange: (hidden: boolean) => void
  onCollapsedChange: (collapsed: boolean) => void
  visibleLabel: string
  collapsedLabel: string
  /** When false, no drag handle (anchored sections). */
  sortable?: boolean
}

function SectionToggles({
  section,
  label,
  hidden,
  collapsed,
  onHiddenChange,
  onCollapsedChange,
  visibleLabel,
  collapsedLabel,
  sortable = true,
}: SectionTogglesProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: section,
    disabled: !sortable,
  })

  return (
    <div
      ref={setNodeRef}
      style={sortable ? { transform: CSS.Transform.toString(transform), transition } : undefined}
      data-customize-section={section}
      className={cn(
        'flex items-center gap-3 rounded-xl border border-border/60 bg-bg-elevated/60 px-3 py-2.5',
        isDragging && 'z-10 border-accent/50 shadow-lg',
        hidden && 'opacity-60',
      )}
    >
      {sortable ? (
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="shrink-0 cursor-grab touch-none rounded-md p-1 text-text-muted hover:bg-bg-hover/70 hover:text-text-primary active:cursor-grabbing"
          aria-label={`Reorder ${label}`}
        >
          <GripVertical size={15} />
        </button>
      ) : (
        <span className="w-7 shrink-0" aria-hidden />
      )}
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text-primary">{label}</span>
      <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-text-muted">
        {collapsedLabel}
        <Switch
          checked={collapsed}
          onCheckedChange={onCollapsedChange}
          disabled={hidden}
          className="h-5 w-9 [&>span]:h-4 [&>span]:w-4 [&>span]:data-[state=checked]:translate-x-[16px]"
        />
      </label>
      <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-text-muted">
        {visibleLabel}
        <Switch
          checked={!hidden}
          onCheckedChange={(checked) => onHiddenChange(!checked)}
          className="h-5 w-9 [&>span]:h-4 [&>span]:w-4 [&>span]:data-[state=checked]:translate-x-[16px]"
        />
      </label>
    </div>
  )
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Customize the Communication rail: drag to reorder middle sections,
 * toggle visibility, and choose which sections start collapsed.
 * Settings stays anchored at the bottom (show/collapse only).
 */
export default function SidebarCustomizeDialog({ open, onOpenChange }: Props) {
  const { t } = useTranslation('nav')
  const { prefs, setOrder, setSectionHidden, setSectionCollapsed, resetPrefs } = useSidebarPrefs()

  const movableOrder = prefs.order.filter((s): s is Exclude<SidebarSection, 'settings'> =>
    (MOVABLE_SECTIONS as readonly string[]).includes(s),
  )

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return
      const oldIndex = movableOrder.indexOf(active.id as Exclude<SidebarSection, 'settings'>)
      const newIndex = movableOrder.indexOf(over.id as Exclude<SidebarSection, 'settings'>)
      if (oldIndex < 0 || newIndex < 0) return
      setOrder([...arrayMove(movableOrder, oldIndex, newIndex), 'settings'])
    },
    [movableOrder, setOrder],
  )

  const visibleLabel = t('support.customize.visible', { defaultValue: 'Show' })
  const collapsedLabel = t('support.customize.collapsed', { defaultValue: 'Collapse' })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('support.customize.title', { defaultValue: 'Customize sidebar' })}</DialogTitle>
          <DialogDescription>
            {t('support.customize.description', {
              defaultValue:
                'Drag Agents and Channels to reorder them. Settings stays at the bottom of the rail.',
            })}
          </DialogDescription>
        </DialogHeader>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={movableOrder} strategy={verticalListSortingStrategy}>
            <div className="space-y-1.5">
              {movableOrder.map((section) => (
                <SectionToggles
                  key={section}
                  section={section}
                  label={t(SECTION_LABELS[section].labelKey, {
                    defaultValue: SECTION_LABELS[section].defaultLabel,
                  })}
                  hidden={prefs.hidden.includes(section)}
                  collapsed={prefs.collapsed.includes(section)}
                  onHiddenChange={(hidden) => setSectionHidden(section, hidden)}
                  onCollapsedChange={(collapsed) => setSectionCollapsed(section, collapsed)}
                  visibleLabel={visibleLabel}
                  collapsedLabel={collapsedLabel}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
        <p className="pt-2 text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted">
          {t('support.customize.anchored', { defaultValue: 'Anchored' })}
        </p>
        <SectionToggles
          section="settings"
          label={t(SECTION_LABELS.settings.labelKey, {
            defaultValue: SECTION_LABELS.settings.defaultLabel,
          })}
          hidden={prefs.hidden.includes('settings')}
          collapsed={prefs.collapsed.includes('settings')}
          onHiddenChange={(hidden) => setSectionHidden('settings', hidden)}
          onCollapsedChange={(collapsed) => setSectionCollapsed('settings', collapsed)}
          visibleLabel={visibleLabel}
          collapsedLabel={collapsedLabel}
          sortable={false}
        />
        <div className="flex justify-end">
          <button
            type="button"
            onClick={resetPrefs}
            className="rounded-lg border border-border/70 px-3 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-bg-hover/70 hover:text-text-primary"
          >
            {t('support.customize.reset', { defaultValue: 'Reset to defaults' })}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
