import { useEffect } from 'react'
import { X } from 'lucide-react'
import type { CloudAgent } from '../../types'
import AgentDetail from './AgentDetail'

export default function AgentDetailModal({
  agent,
  onClose,
}: {
  agent: CloudAgent
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6"
      role="presentation"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
        aria-label="Sluiten"
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={agent.name}
        className="relative z-10 flex w-full max-w-3xl max-h-[min(90vh,920px)] flex-col overflow-hidden rounded-lg border border-border bg-bg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-shrink-0 justify-end border-b border-border bg-bg-elevated/40 px-2 py-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary"
            aria-label="Sluiten"
          >
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <AgentDetail agent={agent} variant="modal" />
        </div>
      </div>
    </div>
  )
}
