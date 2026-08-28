import { FileText, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { MessageAttachment } from '../../lib/inbox-api'

/** Stored chat attachments may omit mime/name (legacy widget `{id, url}`). */
type AttachmentLike = Pick<MessageAttachment, 'id' | 'url'> & Partial<MessageAttachment>

type Props = {
  attachments: AttachmentLike[]
  onRemove?: (id: string) => void
  compact?: boolean
}

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp|svg|avif)(\?|#|$)/i

/** Older widget uploads stored `{id, url}` without mime/name. */
function isImageAttachment(att: AttachmentLike): boolean {
  const mime = String(att.mime || '')
  if (mime.startsWith('image/')) return true
  return IMAGE_EXT.test(att.name || '') || IMAGE_EXT.test(att.url || '')
}

export default function MessageAttachments({ attachments, onRemove, compact }: Props) {
  const { t } = useTranslation('communication')
  if (!attachments.length) return null
  return (
    <div className={`flex flex-wrap gap-2 ${compact ? '' : 'mt-2'}`}>
      {attachments.map((att) => {
        const name = att.name || 'file'
        const isImage = isImageAttachment(att)
        return (
          <div
            key={att.id}
            className="relative flex items-center gap-2 rounded-lg border border-border/60 bg-bg-elevated/60 px-2 py-1.5 text-xs"
          >
            {isImage ? (
              <a href={att.url} target="_blank" rel="noreferrer" className="block">
                <img src={att.url} alt={name} className="h-14 w-14 rounded object-cover" />
              </a>
            ) : (
              <a
                href={att.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 text-text-secondary hover:text-text-primary"
              >
                <FileText size={14} />
                <span className="max-w-[140px] truncate">{name}</span>
              </a>
            )}
            {onRemove ? (
              <button
                type="button"
                onClick={() => onRemove(att.id)}
                className="rounded p-0.5 text-text-muted hover:bg-bg-hover hover:text-text-primary"
                aria-label={t('composer.removeAttachment', { name })}
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
