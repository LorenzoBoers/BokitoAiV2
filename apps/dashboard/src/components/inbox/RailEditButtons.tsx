import type { MouseEvent, PointerEvent } from 'react'
import { Eye, PenLine } from 'lucide-react'
import { Tip } from '../ui/Tip'

const controlClass =
  'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-bg-hover/70 hover:text-text-secondary'

function stopRow(event: MouseEvent | PointerEvent) {
  event.preventDefault()
  event.stopPropagation()
}

export function RailEyeButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Tip label={label}>
      <button
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
      </button>
    </Tip>
  )
}

export function RailPenButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Tip label={label}>
      <button
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
      </button>
    </Tip>
  )
}
