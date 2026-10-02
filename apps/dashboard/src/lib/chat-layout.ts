/**
 * Reading column for conversation surfaces. Timeline rows and the composer
 * share it so bubbles and the input line up on wide screens.
 *
 * Grouping rules live in `@bokito/shared` so the website widget stacks
 * bubbles exactly like the thread timeline.
 */
export const CHAT_COLUMN_CLASS = 'mx-auto w-full max-w-[720px]'

export {
  assignBubbleStacks,
  chatRunCloses,
  chatRunLeads,
  CHAT_STACK_GAP_MS,
  type BubbleStack,
  type ChatStackInput,
} from '@bokito/shared'
