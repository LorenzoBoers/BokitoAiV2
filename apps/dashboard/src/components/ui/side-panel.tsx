import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { cn } from '../../lib/utils'

/**
 * Right-hand detail panel on top of the current page (Radix Dialog under the
 * hood, so focus, Escape and aria stay correct). Use it for object detail that
 * the operator reads next to a list — connections, catalog items — instead of
 * a centered modal.
 */

const SidePanel = DialogPrimitive.Root
const SidePanelClose = DialogPrimitive.Close

const SidePanelContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => {
  const { t } = useTranslation('common')
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="scrim fixed inset-0 z-50 data-[state=open]:animate-fade-in" />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l border-border/70 bg-bg-surface shadow-overlay',
          'data-[state=open]:animate-panel-in',
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          data-dialog-close
          className="absolute right-4 top-4 rounded-md border border-border/60 bg-bg-elevated p-1.5 opacity-85 ring-offset-bg transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-accent"
        >
          <X className="h-4 w-4" />
          <span className="sr-only">{t('actions.close')}</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
})
SidePanelContent.displayName = 'SidePanelContent'

function SidePanelHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('shrink-0 border-b border-border/60 px-5 py-4 pr-14', className)} {...props} />
}

function SidePanelBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('min-h-0 flex-1 overflow-y-auto px-5 py-4', className)} {...props} />
}

const SidePanelTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('title-dialog leading-tight', className)}
    {...props}
  />
))
SidePanelTitle.displayName = 'SidePanelTitle'

const SidePanelDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn('text-sm text-text-muted', className)} {...props} />
))
SidePanelDescription.displayName = 'SidePanelDescription'

export {
  SidePanel,
  SidePanelClose,
  SidePanelContent,
  SidePanelHeader,
  SidePanelBody,
  SidePanelTitle,
  SidePanelDescription,
}
