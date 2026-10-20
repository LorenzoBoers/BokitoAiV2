import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'
import { Skeleton } from './skeleton'
import { Spinner } from './spinner'

function Status({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('skel-stagger', className)} role="status" aria-busy="true">
      {children}
    </div>
  )
}

function Lines({ widths }: { widths: string[] }) {
  return (
    <div className="min-w-0 flex-1 space-y-1.5">
      {widths.map((width) => (
        <Skeleton key={width} className={cn('h-3', width)} />
      ))}
    </div>
  )
}

/** People directory: avatar, name, channel, status. */
export function DirectoryRowsSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <Status className="panel overflow-hidden">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-border/40 px-4 py-2.5 last:border-b-0">
          <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
          <Lines widths={['w-[36%]', 'h-2.5 w-[48%]']} />
          <Skeleton className="hidden h-5 w-16 rounded-full sm:block" />
          <Skeleton className="h-3 w-12" />
        </div>
      ))}
    </Status>
  )
}

/** Company table: favicon, name, domain, count. */
export function CompanyTableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <Status className="panel overflow-hidden">
      <div className="grid grid-cols-[1.4fr_1fr_auto] gap-3 border-b border-border/60 px-4 py-2.5">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-10 justify-self-end" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="grid grid-cols-[1.4fr_1fr_auto] items-center gap-3 border-b border-border/40 px-4 py-2.5 last:border-b-0">
          <div className="flex items-center gap-2.5">
            <Skeleton className="h-7 w-7 shrink-0 rounded-md" />
            <Skeleton className="h-3.5 w-32" />
          </div>
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-3 w-6 justify-self-end" />
        </div>
      ))}
    </Status>
  )
}

/** Contact or company profile: identity, then field rows. */
export function ProfileSkeleton() {
  return (
    <Status className="space-y-4 pt-2">
      <div className="flex items-center gap-3">
        <Skeleton className="h-12 w-12 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-28" />
        </div>
      </div>
      <div className="panel space-y-3 p-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <Skeleton className="h-2.5 w-20" />
            <Skeleton className="h-9 w-full rounded-lg" />
          </div>
        ))}
      </div>
    </Status>
  )
}

/** Label + control rows inside a settings card. */
export function SettingsFieldsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <Status className="space-y-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1.5">
            <Skeleton className="h-3.5 w-36" />
            <Skeleton className="h-2.5 w-52" />
          </div>
          <Skeleton className="h-9 w-40 rounded-lg" />
        </div>
      ))}
    </Status>
  )
}

/** Title, hint, and a switch. */
export function SwitchRowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <Status className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center justify-between gap-3 rounded-lg border border-border/40 px-3 py-2.5">
          <div className="space-y-1.5">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-2.5 w-56" />
          </div>
          <Skeleton className="h-5 w-9 rounded-full" />
        </div>
      ))}
    </Status>
  )
}

/** Three option cards, as on AI handling. */
export function HandlingCardsSkeleton() {
  return (
    <Status className="grid gap-2 sm:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="space-y-2 rounded-lg border border-border/50 p-3">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-2.5 w-full" />
        </div>
      ))}
    </Status>
  )
}

export function StatTilesSkeleton({ tiles = 3 }: { tiles?: number }) {
  return (
    <Status className="grid gap-3 sm:grid-cols-3">
      {Array.from({ length: tiles }).map((_, i) => (
        <div key={i} className="space-y-2 rounded-lg border border-border/50 bg-bg-surface px-4 py-3">
          <Skeleton className="h-2.5 w-20" />
          <Skeleton className="h-7 w-16" />
        </div>
      ))}
    </Status>
  )
}

/** Area chart plus two KPI tiles. */
export function ChartPanelSkeleton() {
  return (
    <Status className="grid items-stretch gap-4 lg:grid-cols-3">
      <Skeleton className="h-52 rounded-lg lg:col-span-2" />
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
        <Skeleton className="h-24 rounded-lg" />
        <Skeleton className="h-24 rounded-lg" />
      </div>
    </Status>
  )
}

/** Article body: kicker, title, paragraphs. */
export function ArticleSkeleton() {
  return (
    <Status className="space-y-4">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-8 w-2/3 max-w-md" />
      <div className="space-y-2 pt-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-[92%]" />
        <Skeleton className="h-3 w-[84%]" />
        <Skeleton className="mt-4 h-3 w-full" />
        <Skeleton className="h-3 w-[70%]" />
      </div>
    </Status>
  )
}

/** Docs index: section title and article rows. */
export function DocsIndexSkeleton({ sections = 3 }: { sections?: number }) {
  return (
    <Status className="space-y-6">
      {Array.from({ length: sections }).map((_, section) => (
        <div key={section} className="space-y-2">
          <Skeleton className="h-4 w-32" />
          {Array.from({ length: 3 }).map((_, row) => (
            <div key={row} className="rounded-lg border border-border/40 px-3 py-2.5">
              <Skeleton className="h-3.5 w-[46%]" />
              <Skeleton className="mt-1.5 h-2.5 w-[72%]" />
            </div>
          ))}
        </div>
      ))}
    </Status>
  )
}

/** Docs chrome: header bar and article column. */
export function DocsShellSkeleton() {
  return (
    <Status className="mx-auto w-full max-w-3xl space-y-5 px-6 py-10">
      <Skeleton className="h-8 w-48" />
      <ArticleSkeleton />
    </Status>
  )
}

/** Numbered setup steps. */
export function StepListSkeleton({ steps = 5 }: { steps?: number }) {
  return (
    <Status className="space-y-3">
      <div className="panel flex items-center gap-3 px-4 py-3">
        <Skeleton className="h-9 w-9 rounded-lg" />
        <div className="space-y-1.5">
          <Skeleton className="h-3.5 w-48" />
          <Skeleton className="h-2.5 w-64" />
        </div>
      </div>
      {Array.from({ length: steps }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 rounded-lg border border-border/50 p-4">
          <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-full max-w-md" />
            <div className="flex gap-2 pt-1">
              <Skeleton className="h-7 w-24 rounded-lg" />
              <Skeleton className="h-7 w-20 rounded-lg" />
            </div>
          </div>
        </div>
      ))}
    </Status>
  )
}

/** Full-screen onboarding card. */
export function WizardSkeleton() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4" role="status" aria-busy="true">
      <div className="w-full max-w-lg space-y-4 rounded-xl border border-border/50 bg-bg-surface p-6">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-24 w-full rounded-lg" />
        <div className="flex justify-between pt-2">
          <Skeleton className="h-9 w-20 rounded-lg" />
          <Skeleton className="h-9 w-24 rounded-lg" />
        </div>
      </div>
    </div>
  )
}

/** Session check before the shell. The next screen is unknown, so this is a spinner. */
export function AuthScreenSkeleton() {
  const { t } = useTranslation('nav')
  return (
    <div
      className="flex min-h-screen items-center justify-center bg-bg"
      role="status"
      aria-busy="true"
      aria-label={t('app.loading')}
    >
      <Spinner size="xl" className="text-text-secondary" />
    </div>
  )
}

/** Workspace picker cards. */
export function WorkspaceCardsSkeleton({ cards = 3 }: { cards?: number }) {
  return (
    <Status className="mx-auto w-full max-w-[860px] space-y-6 px-2 py-10">
      <div className="space-y-2 text-center">
        <Skeleton className="mx-auto h-7 w-48" />
        <Skeleton className="mx-auto h-3 w-64" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: cards }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-lg border border-border/50 p-4">
            <Skeleton className="h-10 w-10 rounded-lg" />
            <div className="space-y-1.5">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-2.5 w-20" />
            </div>
          </div>
        ))}
      </div>
    </Status>
  )
}

/** Channel rows: mark, name, address, state. */
export function ChannelRowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <Status className="divide-y divide-border/50">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />
          <Lines widths={['w-36', 'h-2.5 w-48']} />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      ))}
    </Status>
  )
}

/** Channel settings: back link, title, form sections. */
export function ChannelDetailSkeleton() {
  return (
    <Status className="space-y-4">
      <Skeleton className="h-3 w-28" />
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-lg" />
        <div className="space-y-1.5">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-3 w-32" />
        </div>
      </div>
      <div className="panel space-y-3 p-4">
        <SettingsFieldsSkeleton rows={3} />
      </div>
    </Status>
  )
}

/** Checkbox list, mailbox folders or folder picker. */
export function FolderChecklistSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <Status className="space-y-1">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-2 rounded-md px-2 py-2">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-3 w-40" />
        </div>
      ))}
    </Status>
  )
}

/** Team cards under the directory. */
export function TeamCardsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <Status className="flex flex-col gap-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg border border-border/50 px-4 py-3">
          <div className="flex -space-x-2">
            <Skeleton className="h-8 w-8 rounded-full" />
            <Skeleton className="h-8 w-8 rounded-full" />
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-2.5 w-40" />
          </div>
          <Skeleton className="h-8 w-8 rounded-lg" />
        </div>
      ))}
    </Status>
  )
}

/** Model provider cards. */
export function ModelsCatalogSkeleton() {
  return (
    <Status className="space-y-4">
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-3 w-72" />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="panel space-y-3 p-4">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <Skeleton className="h-9 w-full rounded-lg" />
          <div className="flex gap-2">
            <Skeleton className="h-8 w-24 rounded-lg" />
            <Skeleton className="h-8 w-20 rounded-lg" />
          </div>
        </div>
      ))}
    </Status>
  )
}

export function TokenRowsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <Status className="mt-4 space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center justify-between gap-3 rounded-lg border border-border/50 px-3 py-2.5">
          <div className="space-y-1.5">
            <Skeleton className="h-3.5 w-36" />
            <Skeleton className="h-2.5 w-24" />
          </div>
          <Skeleton className="h-8 w-16 rounded-lg" />
        </div>
      ))}
    </Status>
  )
}

export function WebhookRowsSkeleton({ rows = 3 }: { rows?: number }) {
  return <TokenRowsSkeleton rows={rows} />
}

export function GrantRowsSkeleton({ rows = 3 }: { rows?: number }) {
  return <TokenRowsSkeleton rows={rows} />
}

/** Ops search, three stats, tenant table. */
export function OpsOverviewSkeleton() {
  return (
    <Status className="space-y-4">
      <Skeleton className="h-9 w-full max-w-md rounded-lg" />
      <StatTilesSkeleton />
      <DirectoryRowsSkeleton rows={5} />
    </Status>
  )
}

/** Whole agenda pane: time column and event bands, not a week of cards. */
export function AgendaGridSkeleton() {
  return (
    <div
      className="flex min-h-[28rem] flex-1 flex-col rounded-lg border border-border/40 bg-bg-surface"
      role="status"
      aria-busy="true"
    >
      <div className="skel-stagger flex flex-1 flex-col justify-between gap-3 px-4 py-5">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-2.5 w-10 shrink-0" />
            <Skeleton className={cn('h-8 flex-1 rounded-md', i % 3 === 1 ? 'max-w-[46%]' : 'max-w-full')} />
          </div>
        ))}
      </div>
    </div>
  )
}

/** Checkbox, mark, and name while an agenda rail list loads. */
export function AgendaRailRowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <Status className="space-y-1 px-1.5 pt-0.5">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-2.5 py-1">
          <Skeleton className="h-3.5 w-3.5 shrink-0 rounded" />
          <Skeleton className="h-4 w-4 shrink-0 rounded-full" />
          <Skeleton className="h-3 flex-1" />
        </div>
      ))}
    </Status>
  )
}

/** Organization grid is a scene, so the wait is a spinner in the middle. */
export function OrgCanvasSkeleton() {
  return (
    <div className="flex h-full min-h-0 items-center justify-center" role="status" aria-busy="true">
      <Spinner size="lg" className="text-text-muted" />
    </div>
  )
}

/** Legend rows beside the organization grid. */
export function OrgLegendSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <Status className="space-y-2 px-1.5 py-1">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-2 py-1">
          <Skeleton className="h-6 w-6 rounded-md" />
          <Skeleton className="h-3 flex-1" />
        </div>
      ))}
    </Status>
  )
}

/** Kanban columns for a flow or folder board. */
export function KanbanColumnsSkeleton({ columns = 3 }: { columns?: number }) {
  return (
    <Status className="grid gap-3 md:grid-cols-3">
      {Array.from({ length: columns }).map((_, col) => (
        <div key={col} className="space-y-2 rounded-lg border border-border/50 bg-bg-surface p-2">
          <div className="flex items-center justify-between px-1 py-1">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-4 w-5 rounded-full" />
          </div>
          <Skeleton className="h-16 rounded-lg" />
          <Skeleton className="h-14 rounded-lg" />
        </div>
      ))}
    </Status>
  )
}

/** Doc list beside a reading pane. */
export function DocSplitSkeleton() {
  return (
    <Status className="grid gap-4 lg:grid-cols-[240px_1fr]">
      <div className="space-y-1.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full rounded-md" />
        ))}
      </div>
      <div className="space-y-2 rounded-lg border border-border/40 p-4">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    </Status>
  )
}

export function MemoryRowsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <Status className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="space-y-1.5 rounded-md border border-border/60 px-3 py-2.5">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-3 w-full" />
        </div>
      ))}
    </Status>
  )
}

export function RetentionFieldsSkeleton() {
  return (
    <Status className="max-w-sm space-y-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="space-y-1.5">
          <Skeleton className="h-3 w-36" />
          <Skeleton className="h-9 w-full rounded-lg" />
        </div>
      ))}
    </Status>
  )
}

/** OAuth consent card. */
export function ConsentPanelSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-busy="true">
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-4/5" />
      <div className="space-y-2 pt-2">
        <Skeleton className="h-9 w-full rounded-lg" />
        <Skeleton className="h-9 w-full rounded-lg" />
      </div>
    </div>
  )
}

/** Invite details before the form. */
export function InviteCardSkeleton() {
  return (
    <Status className="space-y-3 py-4">
      <Skeleton className="mx-auto h-12 w-12 rounded-full" />
      <Skeleton className="mx-auto h-4 w-40" />
      <Skeleton className="mx-auto h-3 w-56" />
      <Skeleton className="h-10 w-full rounded-lg" />
    </Status>
  )
}

/** Right-hand contact drawer. */
export function ContactSideSkeleton() {
  return (
    <Status className="space-y-4 px-4 py-4">
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div className="space-y-1.5">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-2.5 w-36" />
        </div>
      </div>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-center justify-between gap-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-24" />
        </div>
      ))}
    </Status>
  )
}

/** Agent context column. */
export function ContextSideSkeleton() {
  return (
    <Status className="space-y-3 px-4 py-3">
      <div className="flex items-center gap-2">
        <Skeleton className="h-8 w-8 rounded-lg" />
        <Skeleton className="h-3.5 w-32" />
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full rounded-lg" />
      ))}
    </Status>
  )
}

export function CalendarListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <Status className="space-y-1">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center justify-between gap-2 rounded-md px-1 py-1.5">
          <div className="flex items-center gap-2">
            <Skeleton className="h-3 w-3 rounded-full" />
            <Skeleton className="h-3 w-36" />
          </div>
          <Skeleton className="h-4 w-8 rounded-full" />
        </div>
      ))}
    </Status>
  )
}

export function McpRowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <Status className="space-y-2 py-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="grid grid-cols-[1.2fr_1fr_1.4fr_auto] items-center gap-3">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-5 w-14 rounded-full" />
        </div>
      ))}
    </Status>
  )
}

export function AgentRosterSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <Status className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-2">
          <Skeleton className="h-7 w-7 rounded-md" />
          <Skeleton className="h-3 w-32" />
        </div>
      ))}
    </Status>
  )
}

export function StaffSelectSkeleton() {
  return <Skeleton className="h-6 w-28 rounded-md" role="status" aria-busy="true" />
}

export function ChipCloudSkeleton({ chips = 6 }: { chips?: number }) {
  return (
    <Status className="flex flex-wrap gap-1.5 px-1 py-2">
      {Array.from({ length: chips }).map((_, i) => (
        <Skeleton key={i} className="h-6 rounded-full" style={{ width: 56 + (i % 3) * 18 }} />
      ))}
    </Status>
  )
}

export function ActivityStepsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <Status className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-start gap-2">
          <Skeleton className="mt-0.5 h-2 w-2 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-1">
            <Skeleton className="h-3 w-[70%]" />
            <Skeleton className="h-2.5 w-[40%]" />
          </div>
        </div>
      ))}
    </Status>
  )
}

/** Notification matrix: label column and channel toggles. */
export function NotificationMatrixSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <Status className="space-y-2">
      <div className="grid grid-cols-[1.4fr_repeat(3,48px)] items-center gap-2 px-1">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3 w-8" />
        <Skeleton className="h-3 w-8" />
        <Skeleton className="h-3 w-8" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="grid grid-cols-[1.4fr_repeat(3,48px)] items-center gap-2 rounded-lg border border-border/40 px-3 py-2">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-4 w-4 rounded" />
        </div>
      ))}
    </Status>
  )
}

export function ResourceRowsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <Status className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg border border-border/40 px-3 py-2">
          <Skeleton className="h-8 w-8 rounded-md" />
          <Lines widths={['w-32', 'h-2.5 w-44']} />
        </div>
      ))}
    </Status>
  )
}

export function ConversationRowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <Status className="space-y-1.5">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-2 rounded-lg px-1 py-1.5">
          <Skeleton className="h-7 w-7 rounded-md" />
          <Lines widths={['w-[48%]', 'h-2.5 w-[64%]']} />
        </div>
      ))}
    </Status>
  )
}

export function AgendaMiniSkeleton() {
  return (
    <Status className="space-y-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex items-center gap-2">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-8 flex-1 rounded-md" />
        </div>
      ))}
    </Status>
  )
}

/** Page body while a route chunk loads. The shell around it stays mounted. */
export function RouteShellSkeleton({ titled = true }: { titled?: boolean }) {
  return (
    <Status className="flex h-full min-h-0 flex-col gap-4">
      {titled ? (
        <div className="flex items-end justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-3 w-64 max-w-full" />
          </div>
          <Skeleton className="hidden h-8 w-24 rounded-lg sm:block" />
        </div>
      ) : null}
      <Skeleton className="h-28 w-full rounded-lg" />
      <Skeleton className="min-h-48 w-full flex-1 rounded-lg" />
    </Status>
  )
}

/** Communication main pane: thread list and conversation. */
export function HubMainSkeleton() {
  return (
    <Status className="flex h-full min-h-0">
      <div className="flex w-80 shrink-0 flex-col gap-2 border-r border-border/40 p-3">
        <Skeleton className="h-8 w-full rounded-lg" />
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-2 py-1">
            <Skeleton className="h-8 w-8 shrink-0 rounded-md" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-2.5 w-5/6" />
            </div>
          </div>
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="min-h-40 flex-1 rounded-lg" />
      </div>
    </Status>
  )
}

/**
 * Whole app while a route chunk loads outside the shell.
 * Rail, top bar, then the page body — the same frame as AppShell.
 */
export function PlatformFrameSkeleton() {
  const { t } = useTranslation('nav')
  return (
    <div
      className="flex h-screen overflow-hidden bg-bg"
      role="status"
      aria-busy="true"
      aria-label={t('app.loading')}
    >
      <aside className="hidden w-rail shrink-0 flex-col border-r border-border/60 px-2 pb-2 pt-2 lg:flex">
        <div className="flex h-11 items-center gap-2 px-1.5">
          <Skeleton className="h-7 w-7 shrink-0 rounded-md" />
          <Skeleton className="h-3.5 min-w-0 flex-1" />
          <Skeleton className="h-7 w-7 shrink-0 rounded-md" />
        </div>
        <div className="mt-1 space-y-1 px-1.5">
          <div className="flex items-center gap-2 py-1.5">
            <Skeleton className="h-4 w-4 shrink-0 rounded" />
            <Skeleton className="h-3 w-28" />
          </div>
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2 py-1.5">
              <Skeleton className="h-4 w-4 shrink-0 rounded" />
              <Skeleton className="h-3 flex-1" style={{ maxWidth: 72 + (i % 3) * 28 }} />
            </div>
          ))}
        </div>
        <div className="mt-auto flex items-center gap-2 px-1.5 py-2">
          <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-2.5 w-32" />
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="relative flex h-11 shrink-0 items-center gap-3 border-b border-border/60 px-3">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="absolute left-1/2 hidden h-7 w-64 -translate-x-1/2 rounded-md sm:block" />
          <div className="ml-auto flex items-center gap-2">
            <Skeleton className="h-7 w-7 rounded-md" />
            <Skeleton className="h-7 w-7 rounded-md" />
          </div>
        </header>
        <div className="min-h-0 flex-1 px-6 pb-8 pt-4">
          <RouteShellSkeleton />
        </div>
      </div>
    </div>
  )
}

/** Govern tabs and ledger rows. */
export function GovernTabsSkeleton() {
  return (
    <Status className="space-y-4">
      <div className="flex gap-2">
        <Skeleton className="h-8 w-20 rounded-lg" />
        <Skeleton className="h-8 w-20 rounded-lg" />
        <Skeleton className="h-8 w-24 rounded-lg" />
      </div>
      <DirectoryRowsSkeleton rows={6} />
    </Status>
  )
}

/** Agent page: face, name, then cards. */
export function AgentIdentitySkeleton() {
  return (
    <Status className="space-y-4">
      <div className="flex items-center gap-3 py-2">
        <Skeleton className="h-14 w-14 rounded-xl" />
        <div className="space-y-2">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-3 w-48" />
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Skeleton className="h-36 rounded-lg" />
        <Skeleton className="h-36 rounded-lg" />
      </div>
    </Status>
  )
}

/** Folder home: title, counts, then sections. */
export function FolderHomeSkeleton() {
  return (
    <Status className="space-y-4">
      <div className="panel space-y-3 p-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-3 w-32" />
      </div>
      <KanbanColumnsSkeleton />
    </Status>
  )
}

/** Flow detail: title bar and stage columns. */
export function FlowHeaderSkeleton() {
  return (
    <Status className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Skeleton className="h-6 w-6 rounded" />
          <Skeleton className="h-6 w-40" />
        </div>
        <Skeleton className="h-8 w-8 rounded-lg" />
      </div>
      <KanbanColumnsSkeleton columns={4} />
    </Status>
  )
}

/** Trash rows with a type mark. */
export function TrashRowsSkeleton({ rows = 5 }: { rows?: number }) {
  return <DirectoryRowsSkeleton rows={rows} />
}

/** Widget settings: preview frame and fields. */
export function WidgetPreviewSkeleton() {
  return (
    <Status className="grid gap-4 lg:grid-cols-[1fr_220px]">
      <div className="space-y-3">
        <Skeleton className="h-9 w-full rounded-lg" />
        <Skeleton className="h-20 w-full rounded-lg" />
      </div>
      <Skeleton className="h-40 rounded-xl" />
    </Status>
  )
}
