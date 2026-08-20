import { FileText, X } from 'lucide-react'
import type { MessageAttachment } from '../../lib/inbox-api'

type Props = {
  attachments: MessageAttachment[]
  onRemove?: (id: string) => void
  compact?: boolean
}

export default function MessageAttachments({ attachments, onRemove, compact }: Props) {
  if (!attachments.length) return null
  return (
    <div className={`flex flex-wrap gap-2 ${compact ? '' : 'mt-2'}`}>
      {attachments.map((att) => {
        const isImage = att.mime.startsWith('image/')
        return (
          <div
            key={att.id}
            className="relative flex items-center gap-2 rounded-lg border border-border/60 bg-bg-elevated/60 px-2 py-1.5 text-xs"
          >
            {isImage ? (
              <a href={att.url} target="_blank" rel="noreferrer" className="block">
                <img src={att.url} alt={att.name} className="h-14 w-14 rounded object-cover" />
              </a>
            ) : (
              <a
                href={att.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 text-text-secondary hover:text-text-primary"
              >
                <FileText size={14} />
                <span className="max-w-[140px] truncate">{att.name}</span>
              </a>
            )}
            {onRemove ? (
              <button
                type="button"
                onClick={() => onRemove(att.id)}
                className="rounded p-0.5 text-text-muted hover:bg-bg-hover hover:text-text-primary"
                aria-label={`Remove ${att.name}`}
              >
                <X size={12} />
              </button>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
