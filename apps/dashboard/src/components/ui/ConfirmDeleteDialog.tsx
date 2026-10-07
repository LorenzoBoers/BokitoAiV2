import { ConfirmDialog } from './confirm-dialog'

type ConfirmDeleteDialogProps = {
  title: string
  itemLabel: string
  itemName: string
  impactText?: string
  isDeleting?: boolean
  onCancel: () => void
  onConfirm: () => Promise<void> | void
}

/** Type-the-name delete confirmation; a preset of ConfirmDialog. */
export default function ConfirmDeleteDialog({
  title,
  itemName,
  impactText,
  isDeleting = false,
  onCancel,
  onConfirm,
}: ConfirmDeleteDialogProps) {
  return (
    <ConfirmDialog
      open
      title={title}
      description={impactText}
      destructive
      typeToConfirm={itemName}
      busy={isDeleting}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  )
}
