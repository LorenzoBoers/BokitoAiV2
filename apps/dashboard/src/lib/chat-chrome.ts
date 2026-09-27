/**
 * Shared Communication chrome — one recipe for customer threads, agent chats,
 * and list rows so channel types feel like one product.
 */

/** Thread / agent chat top bar. */
export const THREAD_HEADER_CLASS =
  'flex min-h-10 shrink-0 items-center gap-2 border-b border-border/40 bg-bg-surface px-3 py-1.5'

/** Clustered icon actions in the thread header. */
export const THREAD_ACTION_CLUSTER_CLASS =
  'flex shrink-0 items-center rounded-lg border border-border/50 bg-bg-elevated/40 p-0.5'

export const THREAD_HEADER_ICON_CLASS =
  'inline-flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/50 disabled:pointer-events-none disabled:opacity-40'

/** Transcript column shared by chat-like surfaces. */
export const THREAD_TRANSCRIPT_CLASS = 'mx-auto w-full max-w-[820px] px-4 py-4'

/** Composer dock under the transcript. */
export const THREAD_COMPOSER_DOCK_CLASS = 'shrink-0 border-t border-border/30 bg-bg-surface/80 px-3 py-3'

/** Agent / note mode left accent on ComposerCard (mirrors ReplyComposer). */
export const COMPOSER_AI_STRIP_CLASS = 'border-border/60 border-l-[3px] border-l-ai/50 bg-bg-surface'

/** Selected list row — fill only; left ink comes from `.row-interactive`. */
export const THREAD_ROW_SELECTED_CLASS = 'bg-accent/[0.07]'

/** AI-decision rows: tint only; strip color via `[data-ai-managed]` in CSS. */
export const THREAD_ROW_AI_CLASS = 'bg-ai/[0.03]'
