/**
 * Shared Communication chrome — one recipe for customer threads, agent chats,
 * and list rows so channel types feel like one product.
 */

/** Thread / agent chat top bar. min-h so participant strip / long titles fit. */
export const THREAD_HEADER_CLASS =
  'flex min-h-11 shrink-0 items-start gap-2 border-b border-border bg-bg px-3 py-2'

/** Clustered icon actions in the thread header. */
export const THREAD_ACTION_CLUSTER_CLASS =
  'flex shrink-0 items-center gap-0.5'

/** Transcript column shared by chat-like surfaces. */
export const THREAD_TRANSCRIPT_CLASS = 'mx-auto w-full max-w-[820px] px-4 py-4'

/** Composer dock under the transcript. */
export const THREAD_COMPOSER_DOCK_CLASS = 'shrink-0 border-t border-border bg-bg px-3 py-3'

/** Legacy AI strip — unused by the Team tab (that uses the default accent tone). */
export const COMPOSER_AI_STRIP_CLASS =
  'border-ai/55 bg-bg-surface focus-within:border-ai/80'

/** Selected list row — same wash as hover; left ink comes from `.row-interactive`. */
export const THREAD_ROW_SELECTED_CLASS = 'bg-bg-hover/50'

/** AI-decision rows: tint only; strip color via `[data-ai-managed]` in CSS. */
export const THREAD_ROW_AI_CLASS = 'bg-ai/[0.03]'
