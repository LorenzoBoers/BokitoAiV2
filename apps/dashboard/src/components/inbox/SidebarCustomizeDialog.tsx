import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pressable } from '../ui/pressable'
import { Button } from '../ui/button'
import { Link } from 'react-router-dom'
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
import { CSS as DndCss } from '@dnd-kit/utilities'
import { Eye, EyeOff, Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useSidebarEditor } from '../../context/SidebarEditorContext'
import { useSidebarPrefs } from '../../context/SidebarPrefsContext'
import type { SidebarSection } from '../../lib/communication-sidebar-prefs'
import { filterCatalog, type CatalogNode } from '../../lib/sidebar-catalog'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'
import { Tip } from '../ui/Tip'
import { cn } from '../../lib/utils'
import { Input } from '../ui/input'

const SECTIONS = new Set(['folders', 'flows', 'channels', 'agents', 'teams', 'settings'])

function isSidebarSection(id: string): id is SidebarSection {
  return SECTIONS.has(id)
}

function groupByParent(nodes: CatalogNode[]): CatalogNode[][] {
  const groups: CatalogNode[][] = []
  for (const node of nodes) {
    const last = groups[groups.length - 1]
    if (last && last[0]?.parentId === node.parentId) last.push(node)
    else groups.push([node])
  }
  return groups
}

type RowProps = {
  node: CatalogNode
  ancestorHidden?: boolean
  searching: boolean
}

function EditorRow({ node, ancestorHidden = false, searching }: RowProps) {
  const { t } = useTranslation('nav')
  const { setSectionHidden, setItemHidden } = useSidebarPrefs()
  const inactive = Boolean(node.hidden) || ancestorHidden
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: node.id,
    disabled: Boolean(node.fixed) || searching || inactive,
  })
  const draggable = !node.fixed && !searching && !inactive
  const eyeLabel = node.hidden ? t('support.customize.show') : t('support.customize.hide')

  const onEye = () => {
    if (node.hideKind === 'section' && isSidebarSection(node.id)) {
      setSectionHidden(node.id, !node.hidden)
      return
    }
    if (node.hideKind !== 'item') return
    if (!node.hidden) {
      if (!setItemHidden(node.id, true)) toast(t('support.customize.keepOne'))
      return
    }
    setItemHidden(node.id, false)
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: DndCss.Transform.toString(transform), transition }}
      className={cn(isDragging && 'relative z-10')}
      data-editor-row={node.id}
    >
      <div className="flex items-center gap-0.5 rounded-md">
        <Pressable
          type="button"
          disabled={inactive}
          className={cn(
            'nav-row h-7 min-w-0 flex-1 text-left text-xs',
            inactive && 'cursor-default text-text-muted opacity-40 hover:bg-transparent',
            draggable && 'cursor-grab active:cursor-grabbing',
          )}
          {...(draggable ? { ...attributes, ...listeners } : {})}
        >
          {node.icon ? (
            <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center" aria-hidden>
              {node.icon}
            </span>
          ) : null}
          <span className="flex min-w-0 flex-1 items-center">
            {node.mark ?? <span className="min-w-0 flex-1 truncate-fade">{node.label}</span>}
          </span>
        </Pressable>
        {node.href ? (
          <Tip label={t('support.customize.manage')}>
            <Link
              to={node.href}
              aria-label={t('support.customize.manage')}
              aria-disabled={inactive}
              tabIndex={inactive ? -1 : undefined}
              className={cn(
                'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-bg-hover hover:text-text-secondary',
                inactive && 'pointer-events-none opacity-40',
              )}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <Settings size={14} aria-hidden />
            </Link>
          </Tip>
        ) : null}
        {node.hideKind !== 'none' ? (
          <Tip label={eyeLabel}>
            <Button variant="ghost" size="iconSm"
              type="button"
              aria-label={eyeLabel}
              aria-pressed={!node.hidden}
              className="shrink-0 text-text-muted"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                onEye()
              }}
            >
              {node.hidden ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
            </Button>
          </Tip>
        ) : null}
      </div>
      {node.children.length > 0 ? (
        <div className={node.hideKind === 'section' ? 'space-y-px' : 'nav-tree-children'}>
          {groupByParent(node.children).map((group) => (
            <SortableContext
              key={group[0].parentId}
              items={group.map((child) => child.id)}
              strategy={verticalListSortingStrategy}
            >
              {group.map((child) => (
                <EditorRow
                  key={child.id}
                  node={child}
                  ancestorHidden={inactive}
                  searching={searching}
                />
              ))}
            </SortableContext>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export default function SidebarCustomizeDialog() {
  const { t } = useTranslation('nav')
  const { open, focusId, catalog, closeEditor } = useSidebarEditor()
  const { setOrder, setParentOrder, resetPrefs } = useSidebarPrefs()
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!open) return
    setQuery('')
    if (!focusId) return
    const frame = window.requestAnimationFrame(() => {
      document.querySelector(`[data-editor-row="${CSS.escape(focusId)}"]`)?.scrollIntoView({ block: 'nearest' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [open, focusId])

  const searching = query.trim().length > 0
  const shown = useMemo(() => filterCatalog(catalog, query), [catalog, query])
  const anchoredIndex = shown.findIndex((node) => node.id === 'contacts' || node.id === 'settings')

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const parentOf = useMemo(() => {
    const map = new Map<string, string>()
    const walk = (nodes: CatalogNode[]) => {
      for (const node of nodes) {
        map.set(node.id, node.parentId)
        walk(node.children)
      }
    }
    walk(catalog)
    return map
  }, [catalog])

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (searching) return
      const activeId = String(event.active.id)
      const overId = event.over ? String(event.over.id) : ''
      if (!overId || activeId === overId) return
      const parent = parentOf.get(activeId)
      if (!parent || parent !== parentOf.get(overId)) return
      const siblings: string[] = []
      const walk = (nodes: CatalogNode[]) => {
        for (const node of nodes) {
          if (node.parentId === parent) siblings.push(node.id)
          walk(node.children)
        }
      }
      walk(catalog)
      const oldIndex = siblings.indexOf(activeId)
      const newIndex = siblings.indexOf(overId)
      if (oldIndex < 0 || newIndex < 0) return
      const next = arrayMove(siblings, oldIndex, newIndex)
      if (parent === 'root') {
        const middle = next.filter((id): id is SidebarSection => isSidebarSection(id) && id !== 'settings')
        setOrder([...middle, 'settings'])
        return
      }
      setParentOrder(parent, next)
    },
    [catalog, parentOf, searching, setOrder, setParentOrder],
  )

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) closeEditor() }}>
      <DialogContent className="flex max-h-[min(640px,85vh)] max-w-md flex-col gap-3">
        <DialogHeader>
          <DialogTitle>{t('support.customize.title')}</DialogTitle>
          <DialogDescription>{t('support.customize.description')}</DialogDescription>
        </DialogHeader>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('support.customize.search')}
          aria-label={t('support.customize.search')}
          className="h-8 w-full text-xs"
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={shown.map((node) => node.id)} strategy={verticalListSortingStrategy}>
              {shown.map((node, index) => (
                <div key={node.id}>
                  {index === anchoredIndex ? (
                    <p className="px-2 pb-1 pt-3 text-xs font-medium text-text-muted">
                      {t('support.customize.anchored')}
                    </p>
                  ) : null}
                  <EditorRow node={node} searching={searching} />
                </div>
              ))}
            </SortableContext>
          </DndContext>
        </div>
        <div className="flex justify-end">
          <Button variant="secondary" size="xs"
            type="button"
            onClick={resetPrefs}
           
          >
            {t('support.customize.reset')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
