import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react'
import { Toaster as Sonner } from 'sonner'
import { cn } from '../../lib/utils'
import { buttonVariants } from './button'
import { Spinner } from './spinner'

/** The toast sheet: elevated surface, hairline border, overlay shadow. */
export const TOAST_CARD_CLASS =
  'group/toast pointer-events-auto relative flex w-full items-center gap-3 rounded-lg border border-border bg-bg-elevated px-3.5 py-3 font-sans text-sm text-text-heading shadow-overlay'

/** Dismiss control: last in the row, shown on hover or keyboard focus. */
export const TOAST_CLOSE_CLASS =
  'order-last -mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-muted opacity-0 transition-opacity hover:bg-bg-hover hover:text-text-heading focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus group-hover/toast:opacity-100 [&_svg]:h-3.5 [&_svg]:w-3.5'

/** Inline action ("Undo", "Open"): quiet, accent text. */
export const TOAST_ACTION_CLASS = cn(
  buttonVariants({ variant: 'ghost', size: 'xs' }),
  'shrink-0 text-accent-ink hover:text-accent-ink',
)

const TOP_OFFSET = 60

/** App-wide toast region, top right under the topbar. */
export function Toaster() {
  return (
    <Sonner
      closeButton
      position="top-right"
      offset={{ top: TOP_OFFSET, right: 16 }}
      mobileOffset={{ top: TOP_OFFSET, right: 12, left: 12 }}
      gap={8}
      visibleToasts={3}
      icons={{
        success: <CircleCheck size={16} className="text-status-success" aria-hidden />,
        error: <CircleAlert size={16} className="text-status-error" aria-hidden />,
        warning: <TriangleAlert size={16} className="text-status-warning" aria-hidden />,
        info: <Info size={16} className="text-status-info" aria-hidden />,
        loading: <Spinner size="md" className="text-text-muted" />,
      }}
      toastOptions={{
        unstyled: true,
        duration: 3400,
        classNames: {
          toast: TOAST_CARD_CLASS,
          icon: 'flex shrink-0 items-center',
          content: 'flex min-w-0 flex-1 flex-col gap-0.5',
          title: 'font-medium leading-5',
          description: 'text-xs leading-snug text-text-muted',
          actionButton: TOAST_ACTION_CLASS,
          cancelButton: buttonVariants({ variant: 'ghost', size: 'xs' }),
          closeButton: TOAST_CLOSE_CLASS,
        },
      }}
    />
  )
}

export default Toaster
