import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy } from 'lucide-react'
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
  /** Require this exact value before confirming. Clicking the phrase copies it into the field. */
  typeToConfirm?: string
  /** Shown under the field when the action fails and the dialog stays open. */
  error?: ReactNode
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
  error,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const { t } = useTranslation('common')
  const [typed, setTyped] = useState('')
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<number | null>(null)
  const needsTyping = Boolean(typeToConfirm)
  const matches = !needsTyping || typed.trim() === typeToConfirm

  useEffect(() => {
    setTyped('')
    setCopied(false)
  }, [open, typeToConfirm])

  useEffect(() => {
    return () => {
      if (copyTimer.current != null) window.clearTimeout(copyTimer.current)
    }
  }, [])

  const copyPhrase = useCallback(async () => {
    if (!typeToConfirm) return
    setTyped(typeToConfirm)
    try {
      await navigator.clipboard.writeText(typeToConfirm)
    } catch {
      // The field is filled either way; clipboard can be blocked.
    }
    setCopied(true)
    if (copyTimer.current != null) window.clearTimeout(copyTimer.current)
    copyTimer.current = window.setTimeout(() => setCopied(false), 1500)
  }, [typeToConfirm])

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
          <DialogTitle>{title ?? t('confirmDialog.title')}</DialogTitle>
          {description ? (
            <DialogDescription className="whitespace-pre-line text-sm text-text-secondary">
              {description}
            </DialogDescription>
          ) : null}
        </DialogHeader>
        {needsTyping ? (
          <div className="space-y-2">
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
              <span>{t('confirmDialog.typeLead')}</span>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-auto max-w-full whitespace-normal px-1.5 py-0.5 text-left font-mono text-xs"
                aria-label={copied ? t('actions.copied') : t('actions.copy')}
                onClick={() => void copyPhrase()}
              >
                <span className="min-w-0 break-all">{typeToConfirm}</span>
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </Button>
              <span>{t('confirmDialog.typeTail')}</span>
            </p>
            <Input
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder={t('confirmDialog.typePlaceholder', { value: typeToConfirm })}
              autoFocus
              autoComplete="off"
              data-testid="confirm-type-input"
              onKeyDown={(event) => {
                if (event.key === 'Enter' && matches && !busy) {
                  event.preventDefault()
                  void Promise.resolve(onConfirm())
                }
              }}
            />
          </div>
        ) : null}
        {error ? <p className="text-xs text-status-error">{error}</p> : null}
        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={onCancel}
          >
            {cancelLabel ?? t('actions.cancel')}
          </Button>
          <Button
            type="button"
            variant={destructive ? 'destructive' : 'default'}
            disabled={!matches || busy}
            autoFocus={!needsTyping}
            onClick={() => {
              void Promise.resolve(onConfirm())
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
