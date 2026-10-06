import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { stageLabel, type CollectStageFields, type TicketStage, type TicketStageField } from '../../lib/tickets-api'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { TicketFieldControl } from './TicketFieldControl'

type Pending = {
  stage: TicketStage
  fields: TicketStageField[]
  values: Record<string, string>
  ticketName?: string
  resolve: (values: Record<string, string> | null) => void
}

const CollectContext = createContext<CollectStageFields | null>(null)

/** Prompt for a stage's required fields before a ticket can move. */
export function TicketStageGateProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation('nav')
  const [pending, setPending] = useState<Pending | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const pendingRef = useRef<Pending | null>(null)

  const collect = useCallback<CollectStageFields>((args) => {
    return new Promise((resolve) => {
      const next: Pending = { ...args, resolve }
      pendingRef.current = next
      setDraft(
        Object.fromEntries(args.fields.map((field) => [field.key, (args.values[field.key] ?? '').trim()])),
      )
      setPending(next)
    })
  }, [])

  const close = (values: Record<string, string> | null) => {
    const current = pendingRef.current
    if (!current) return
    pendingRef.current = null
    current.resolve(values)
    setPending(null)
    setDraft({})
  }

  const valid =
    pending?.fields.every((field) => !field.required || Boolean((draft[field.key] || '').trim())) ?? false

  return (
    <CollectContext.Provider value={collect}>
      {children}
      <Dialog
        open={pending != null}
        onOpenChange={(open) => {
          if (!open) close(null)
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {pending ? t('tickets.stageFieldsTitle', { stage: stageLabel(pending.stage, t) }) : ''}
            </DialogTitle>
            <DialogDescription>
              {pending?.ticketName
                ? t('tickets.stageFieldsHintNamed', { name: pending.ticketName })
                : t('tickets.stageFieldsHint')}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-72 space-y-2 overflow-y-auto">
            {(pending?.fields ?? []).map((field) => (
              <label key={field.key} className="block space-y-1">
                <span className="text-xs font-medium text-text-heading">
                  {field.name}
                  {field.required ? <span className="ml-1 text-status-error">*</span> : null}
                </span>
                <TicketFieldControl
                  field={field}
                  value={draft[field.key] ?? ''}
                  disabled={false}
                  onChange={(value) => setDraft((prev) => ({ ...prev, [field.key]: value }))}
                />
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(null)}>
              {t('tickets.stageFieldsCancel')}
            </Button>
            <Button type="button" disabled={!valid} onClick={() => close(draft)}>
              {t('tickets.stageFieldsSubmit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CollectContext.Provider>
  )
}

export function useCollectStageFields(): CollectStageFields | undefined {
  return useContext(CollectContext) ?? undefined
}
