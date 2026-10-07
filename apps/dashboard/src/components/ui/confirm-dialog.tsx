import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog'
import { Button } from './button'
import { Input } from './input'
import { Spinner } from './spinner'

export type ConfirmOptions = {
  title?: ReactNode
  description?: ReactNode
  confirmLabel?: ReactNode
  cancelLabel?: ReactNode
  /** Red confirm button for deletes and other irreversible actions. */
  destructive?: boolean
  /** Require typing this exact value before confirming. */
  typeToConfirm?: string
}

type ConfirmDialogProps = ConfirmOptions & {
  open: boolean
  busy?: boolean
  onCancel: () => void
  onConfirm: () => void | Promise<void>
}

/** The one confirmation dialog (controlled). Prefer `useConfirm()` in handlers. */
export function ConfirmDialog({
  open,
  busy = false,
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive = false,
  typeToConfirm,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const { t } = useTranslation('common')
  const [typed, setTyped] = useState('')
  const needsTyping = Boolean(typeToConfirm)
  const matches = !needsTyping || typed.trim() === typeToConfirm

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) {
          setTyped('')
          onCancel()
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">{title ?? t('confirmDialog.title')}</DialogTitle>
          {description ? (
            <DialogDescription className="whitespace-pre-line text-sm text-text-secondary">
              {description}
            </DialogDescription>
          ) : null}
        </DialogHeader>
        {needsTyping ? (
          <div className="space-y-2">
            <p className="text-xs text-text-muted">
              {t('confirmDialog.typeToConfirm', { value: typeToConfirm })}
            </p>
            <Input
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder={t('confirmDialog.typePlaceholder', { value: typeToConfirm })}
              autoFocus
            />
          </div>
        ) : null}
        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setTyped('')
              onCancel()
            }}
          >
            {cancelLabel ?? t('actions.cancel')}
          </Button>
          <Button
            type="button"
            variant={destructive ? 'destructive' : 'default'}
            disabled={!matches || busy}
            autoFocus={!needsTyping}
            onClick={() => {
              void Promise.resolve(onConfirm()).then(() => setTyped(''))
            }}
          >
            {busy ? <Spinner size="sm" /> : null}
            {confirmLabel ?? (destructive ? t('actions.delete') : t('actions.confirm'))}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export type ConfirmFn = (options: ConfirmOptions | string) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

/** Mount once near the root; enables `useConfirm()` everywhere below. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<((ok: boolean) => void) | null>(null)

  const settle = useCallback((ok: boolean) => {
    resolver.current?.(ok)
    resolver.current = null
    setOptions(null)
  }, [])

  const confirm = useCallback<ConfirmFn>((input) => {
    resolver.current?.(false)
    const next = typeof input === 'string' ? { description: input } : input
    setOptions(next)
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
    })
  }, [])

  const value = useMemo(() => confirm, [confirm])

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <ConfirmDialog
        open={options !== null}
        {...(options ?? {})}
        onCancel={() => settle(false)}
        onConfirm={() => settle(true)}
      />
    </ConfirmContext.Provider>
  )
}

/**
 * Promise-based confirmation, the replacement for `window.confirm`:
 * `if (!(await confirm({ description, destructive: true }))) return`.
 */
export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext) ?? nativeConfirm
}

/** Outside the provider (isolated tests, embeds) fall back to the browser prompt. */
const nativeConfirm: ConfirmFn = (input) => {
  const text =
    typeof input === 'string' ? input : String(input.description ?? input.title ?? '')
  return Promise.resolve(typeof window !== 'undefined' && window.confirm(text))
}

export default ConfirmDialog
