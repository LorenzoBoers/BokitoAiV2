import { Button } from '../ui/button'
import type { MouseEvent, PointerEvent } from 'react'
import { Eye, PenLine } from 'lucide-react'
import { Tip } from '../ui/Tip'

const controlClass =
  'shrink-0 text-text-muted hover:text-text-secondary'

function stopRow(event: MouseEvent | PointerEvent) {
  event.preventDefault()
  event.stopPropagation()
}

export function RailEyeButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Tip label={label}>
      <Button variant="ghost" size="iconSm"
        type="button"
        aria-label={label}
        className={controlClass}
        onPointerDown={stopRow}
        onClick={(event) => {
          stopRow(event)
          onClick()
        }}
      >
        <Eye size={14} aria-hidden />
      </Button>
    </Tip>
  )
}

export function RailPenButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Tip label={label}>
      <Button variant="ghost" size="iconSm"
        type="button"
        aria-label={label}
        className={controlClass}
        onPointerDown={stopRow}
        onClick={(event) => {
          stopRow(event)
          onClick()
        }}
      >
        <PenLine size={14} aria-hidden />
      </Button>
    </Tip>
  )
}
