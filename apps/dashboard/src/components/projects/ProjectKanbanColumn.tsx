import type { ReactNode } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { cn } from '../../lib/utils'

export function ProjectKanbanColumn({
  id,
  title,
  count,
  children,
  fill = false,
}: {
  id: string
  title: string
  count: number
  children: ReactNode
  fill?: boolean
}) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <section
      ref={setNodeRef}
      className={cn(
        'flex min-h-[16rem] shrink-0 flex-col rounded-lg border border-border/50 bg-bg-input/25',
        fill ? 'min-w-[11rem] flex-1' : 'w-[13.5rem]',
        isOver && 'border-accent/70 bg-accent/5',
      )}
    >
      <header className="flex items-center justify-between gap-2 px-2.5 py-2">
        <h4 className="min-w-0 truncate text-xs font-medium text-text-heading">{title}</h4>
        <span className="text-2xs tabular-nums text-text-muted">{count}</span>
      </header>
      <div className="flex min-h-32 flex-1 flex-col gap-1.5 px-1.5 pb-2">{children}</div>
    </section>
  )
}
