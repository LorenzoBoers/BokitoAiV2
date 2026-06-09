import { useMemo, useState } from 'react'
import { Button } from './button'
import { Input } from './input'
import { Card, CardContent, CardHeader, CardTitle } from './card'

type ConfirmDeleteDialogProps = {
  title: string
  itemLabel: string
  itemName: string
  impactText?: string
  isDeleting?: boolean
  onCancel: () => void
  onConfirm: () => Promise<void> | void
}

export default function ConfirmDeleteDialog({
  title,
  itemLabel,
  itemName,
  impactText,
  isDeleting = false,
  onCancel,
  onConfirm,
}: ConfirmDeleteDialogProps) {
  const [typed, setTyped] = useState('')

  const matches = useMemo(() => typed.trim() === itemName, [typed, itemName])

  return (
    <div className="fixed inset-0 z-[70] bg-black/45 backdrop-blur-[1px] flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-text-secondary">
            Type the name of {itemLabel} to confirm: <strong className="text-text-primary">{itemName}</strong>
          </p>
          {impactText ? <p className="text-xs text-text-muted">{impactText}</p> : null}
          <Input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder={`Type exactly: ${itemName}`}
            autoFocus
          />
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={onCancel} disabled={isDeleting}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!matches || isDeleting}
              onClick={() => void onConfirm()}
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

