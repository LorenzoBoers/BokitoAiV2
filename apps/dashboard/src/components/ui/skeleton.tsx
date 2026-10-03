import * as React from 'react'
import { cn } from '../../lib/utils'

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('skeleton-shimmer rounded-md', className)}
      {...props}
    />
  )
}

function SkeletonGrid({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-8" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
          {Array.from({ length: cols }).map((_, colIndex) => (
            <Skeleton key={colIndex} className="h-10" />
          ))}
        </div>
      ))}
    </div>
  )
}

function SkeletonCard() {
  return (
    <div className="panel space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-6 w-6 shrink-0 rounded-md" />
      </div>
      <Skeleton className="h-3 w-1/2" />
      <div className="space-y-2 pt-1">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
      </div>
      <div className="flex gap-2 border-t border-border/40 pt-3">
        <Skeleton className="h-5 w-14 rounded-full" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
    </div>
  )
}

function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="panel">
      <div className="panel-header">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="space-y-3 p-4">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4">
            <Skeleton className="h-4 w-4 rounded" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  )
}

function InboxListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="skel-stagger space-y-0.5 p-1.5" role="status" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-start gap-2 rounded-lg px-2.5 py-2"
          style={{ '--stagger': i } as React.CSSProperties}
        >
          <Skeleton className="mt-0.5 h-7 w-7 shrink-0 rounded-md" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Skeleton className="h-3.5 w-[58%]" />
              <Skeleton className="h-2.5 w-10" />
            </div>
            <Skeleton className="h-3 w-[76%]" />
            {i % 3 === 0 ? <Skeleton className="h-2.5 w-[42%]" /> : null}
          </div>
        </div>
      ))}
    </div>
  )
}

function InboxThreadSkeleton() {
  return (
    <div className="animate-fade-in flex h-full min-h-0 flex-1 flex-col" role="status" aria-busy="true">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/40 px-4 py-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-36" />
            <Skeleton className="h-2.5 w-48" />
          </div>
        </div>
        <div className="flex gap-1">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <Skeleton className="h-8 w-8 rounded-lg" />
          <Skeleton className="h-8 w-16 rounded-lg" />
        </div>
      </div>
      <div className="skel-stagger min-h-0 flex-1 space-y-3.5 overflow-hidden px-4 py-5">
        <div className="flex items-end gap-2">
          <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
          <Skeleton className="h-[4.5rem] w-[58%] rounded-xl rounded-tl-md" />
        </div>
        <div className="flex items-end justify-end gap-2">
          <Skeleton className="h-12 w-[44%] rounded-xl rounded-tr-md" />
        </div>
        <div className="flex items-end gap-2">
          <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
          <Skeleton className="h-16 w-[66%] rounded-xl rounded-tl-md" />
        </div>
        <div className="flex items-end justify-end gap-2">
          <Skeleton className="h-10 w-[38%] rounded-xl rounded-tr-md" />
        </div>
        <div className="flex max-w-[78%] items-center gap-2 pl-9">
          <Skeleton className="h-3.5 w-40" />
        </div>
      </div>
      <div className="shrink-0 space-y-2 border-t border-border/40 px-4 py-3">
        <div className="flex gap-1.5">
          <Skeleton className="h-6 w-14 rounded-full" />
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
        <Skeleton className="h-[3.25rem] w-full rounded-lg" />
      </div>
    </div>
  )
}

function InboxSplitSkeleton() {
  return (
    <div
      className="animate-fade-in flex h-full min-h-0 overflow-hidden rounded-md"
      role="status"
      aria-busy="true"
    >
      <div className="hidden h-full w-[288px] shrink-0 flex-col border-r border-border/40 md:flex">
        <div className="shrink-0 space-y-2 border-b border-border/40 px-3 py-2.5">
          <Skeleton className="h-8 w-full rounded-lg" />
          <div className="flex gap-1.5">
            <Skeleton className="h-6 w-12 rounded-full" />
            <Skeleton className="h-6 w-14 rounded-full" />
            <Skeleton className="h-6 w-10 rounded-full" />
          </div>
        </div>
        <InboxListSkeleton />
      </div>
      <div className="min-w-0 flex-1">
        <InboxThreadSkeleton />
      </div>
    </div>
  )
}

function ChatTranscriptSkeleton() {
  return (
    <div className="skel-stagger space-y-3.5 px-1" role="status" aria-busy="true">
      <div className="flex items-end justify-end gap-2">
        <Skeleton className="h-11 w-[48%] rounded-xl rounded-tr-md" />
      </div>
      <div className="flex items-end gap-2">
        <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
        <Skeleton className="h-16 w-[62%] rounded-xl rounded-tl-md" />
      </div>
      <div className="flex items-end justify-end gap-2">
        <Skeleton className="h-9 w-[36%] rounded-xl rounded-tr-md" />
      </div>
      <div className="flex max-w-[82%] items-center gap-2 pl-9">
        <Skeleton className="h-3.5 w-40" />
      </div>
    </div>
  )
}

function CardGridSkeleton({ cards = 6, className }: { cards?: number; className?: string }) {
  return (
    <div
      className={cn('skel-stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3', className)}
      role="status"
      aria-busy="true"
    >
      {Array.from({ length: cards }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  )
}

function TableRowsSkeleton({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('skel-stagger space-y-2', className)} role="status" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-lg border border-border/40 px-3 py-2.5"
        >
          <Skeleton className="h-8 w-8 shrink-0 rounded-md" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-[46%]" />
            <Skeleton className="h-2.5 w-[68%]" />
          </div>
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </div>
  )
}

/** Overview snapshot strip — mirrors Cockpit StatCard density. */
function CockpitSnapshotSkeleton({ cards = 7 }: { cards?: number }) {
  return (
    <div
      className="skel-stagger grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7"
      role="status"
      aria-busy="true"
    >
      {Array.from({ length: cards }).map((_, i) => (
        <div
          key={i}
          className="flex h-full flex-col rounded-lg border border-border/60 bg-bg-surface px-4 py-3.5"
        >
          <div className="flex items-center justify-between">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="h-3 w-3 rounded" />
          </div>
          <Skeleton className="mt-3 h-6 w-14" />
          <Skeleton className="mt-2 h-2.5 w-20" />
        </div>
      ))}
    </div>
  )
}

/** Freeform project canvas board placeholder. */
function ProjectCanvasSkeleton() {
  return (
    <div className="animate-fade-in space-y-3" role="status" aria-busy="true">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border/50 bg-bg-surface px-3 py-3">
        <div className="space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-64" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-20 rounded-lg" />
          <Skeleton className="h-8 w-24 rounded-lg" />
        </div>
      </div>
      <div className="skel-stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="space-y-2.5 rounded-lg border border-border/50 bg-bg-surface p-3"
            style={{
              gridColumn: i === 0 || i === 3 ? 'span 2' : undefined,
              minHeight: i % 2 === 0 ? 140 : 112,
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-5 w-10 rounded-full" />
            </div>
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  )
}

/** Compact nav / sidebar section rows while folders load. */
function NavSectionSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="skel-stagger space-y-1 px-1.5 py-0.5" role="status" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-2 rounded-lg px-2 py-1.5">
          <Skeleton className="h-3.5 w-3.5 shrink-0 rounded" />
          <Skeleton className="h-3 flex-1" />
        </div>
      ))}
    </div>
  )
}

/** Two-column Overview attention / activity panels. */
function CockpitPanelsSkeleton({ className }: { className?: string } = {}) {
  return (
    <div
      className={cn('grid gap-4 lg:grid-cols-2', className)}
      role="status"
      aria-busy="true"
    >
      {Array.from({ length: 2 }).map((_, panel) => (
        <div
          key={panel}
          className="rounded-lg border border-border/60 bg-bg-surface p-4"
        >
          <div className="space-y-1.5">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-2.5 w-48" />
          </div>
          <div className="skel-stagger mt-3 space-y-1.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-2.5 rounded-lg border border-border/40 px-3 py-2"
              >
                <Skeleton className="h-1.5 w-1.5 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-[55%]" />
                  <Skeleton className="h-2.5 w-[72%]" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export {
  Skeleton,
  SkeletonGrid,
  SkeletonCard,
  SkeletonTable,
  InboxListSkeleton,
  InboxThreadSkeleton,
  InboxSplitSkeleton,
  ChatTranscriptSkeleton,
  CardGridSkeleton,
  TableRowsSkeleton,
  CockpitSnapshotSkeleton,
  CockpitPanelsSkeleton,
  ProjectCanvasSkeleton,
  NavSectionSkeleton,
}
