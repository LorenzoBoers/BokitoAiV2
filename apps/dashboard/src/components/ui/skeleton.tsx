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
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-1/2" />
      <div className="space-y-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
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
        <div key={i} className="flex items-start gap-2 rounded-lg px-2 py-2">
          <Skeleton className="mt-0.5 h-7 w-7 shrink-0 rounded-md" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Skeleton className="h-3.5 w-[58%]" />
              <Skeleton className="h-2.5 w-10" />
            </div>
            <Skeleton className="h-3 w-[76%]" />
            <Skeleton className="h-2.5 w-[42%]" />
          </div>
        </div>
      ))}
    </div>
  )
}

function InboxThreadSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col" role="status" aria-busy="true">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/40 px-4 py-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-56" />
        </div>
        <div className="flex gap-1.5">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <Skeleton className="h-8 w-8 rounded-lg" />
          <Skeleton className="h-8 w-8 rounded-lg" />
        </div>
      </div>
      <div className="skel-stagger min-h-0 flex-1 space-y-4 overflow-hidden px-4 py-5">
        <div className="flex justify-start">
          <Skeleton className="h-16 w-[62%] rounded-2xl rounded-tl-md" />
        </div>
        <div className="flex justify-end">
          <Skeleton className="h-11 w-[46%] rounded-2xl rounded-tr-md" />
        </div>
        <div className="flex justify-start">
          <Skeleton className="h-20 w-[70%] rounded-2xl rounded-tl-md" />
        </div>
        <div className="agent-live-status is-active max-w-[82%]">
          <div className="agent-live-line is-current">
            <span aria-hidden className="agent-live-dot shrink-0" />
            <Skeleton className="h-3.5 w-44 bg-ai/15" />
          </div>
        </div>
      </div>
      <div className="shrink-0 border-t border-border/40 px-4 py-3">
        <Skeleton className="h-16 w-full rounded-xl" />
      </div>
    </div>
  )
}

function InboxSplitSkeleton() {
  return (
    <div className="flex h-full min-h-0 overflow-hidden rounded-md" role="status" aria-busy="true">
      <div className="hidden h-full w-[288px] shrink-0 flex-col border-r border-border/40 md:flex">
        <div className="shrink-0 border-b border-border/40 px-3 py-2">
          <Skeleton className="h-8 w-full rounded-lg" />
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
    <div className="skel-stagger space-y-4" role="status" aria-busy="true">
      <div className="flex justify-end">
        <Skeleton className="h-11 w-[48%] rounded-2xl rounded-tr-md" />
      </div>
      <div className="agent-live-status is-active max-w-[82%]">
        <div className="agent-live-line is-current">
          <span aria-hidden className="agent-live-dot shrink-0" />
          <Skeleton className="h-3.5 w-40 bg-ai/15" />
        </div>
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
        <div key={i} className="flex items-center gap-3 rounded-lg border border-border/40 px-3 py-2.5">
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
}
