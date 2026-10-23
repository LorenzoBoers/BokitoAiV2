import { Pressable } from '../ui/pressable'
import { FileText, X } from 'lucide-react'
import { Button } from '../ui/button'
import { Skeleton } from '../ui/skeleton'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MessageAttachment } from '../../lib/inbox-api'

/** Stored chat attachments may omit mime/name (legacy widget `{id, url}`). */
type AttachmentLike = Pick<MessageAttachment, 'id' | 'url'> & Partial<MessageAttachment>

type Props = {
  attachments: AttachmentLike[]
  onRemove?: (id: string) => void
  compact?: boolean
  /** Inside the composer border: cropped thumbs in one horizontal row. */
  placement?: 'thread' | 'composer'
  /** Shown while a paste or file pick is still uploading. */
  pending?: boolean
}

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp|svg|avif)(\?|#|$)/i

/** Older widget uploads stored `{id, url}` without mime/name. */
function isImageAttachment(att: AttachmentLike): boolean {
  const mime = String(att.mime || '')
  if (mime.startsWith('image/')) return true
  return IMAGE_EXT.test(att.name || '') || IMAGE_EXT.test(att.url || '')
}

function LazyThumb({ url, name }: { url: string; name: string }) {
  const ref = useRef<HTMLAnchorElement>(null)
  const [show, setShow] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setShow(true)
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setShow(true)
          observer.disconnect()
        }
      },
      { rootMargin: '120px 0px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <a ref={ref} href={url} target="_blank" rel="noreferrer" className="block">
      {show ? (
        <img
          src={url}
          alt={name}
          loading="lazy"
          decoding="async"
          className="max-h-52 max-w-full rounded-md object-contain"
        />
      ) : (
        <span className="block h-24 w-36 rounded-md bg-bg-hover" aria-hidden />
      )}
    </a>
  )
}

export default function MessageAttachments({
  attachments,
  onRemove,
  compact,
  placement = 'thread',
  pending = false,
}: Props) {
  const { t } = useTranslation('communication')
  if (!attachments.length && !pending) return null

  if (placement === 'composer') {
    return (
      <div className="flex gap-2 overflow-x-auto px-2 pb-0.5 pt-2 [scrollbar-width:thin]">
        {attachments.map((att) => {
          const name = att.name || 'file'
          const isImage = isImageAttachment(att)
          if (!isImage) {
            return (
              <div
                key={att.id}
                className="composer-thumb-in flex h-16 max-w-40 shrink-0 items-center gap-1.5 self-center rounded-lg border border-border bg-bg-elevated px-2 text-xs shadow-sm"
              >
                <FileText size={14} className="shrink-0 text-text-muted" />
                <span className="min-w-0 truncate-fade text-text-secondary">{name}</span>
                {onRemove ? (
                  <Button variant="ghost" size="iconSm"
                    type="button"
                    onClick={() => onRemove(att.id)}
                   
                    aria-label={t('composer.removeAttachment', { name })}
                  >
                    <X size={14} />
                  </Button>
                ) : null}
              </div>
            )
          }
          return (
            <div key={att.id} className="group/thumb relative h-16 w-24 shrink-0">
              <a
                href={att.url}
                target="_blank"
                rel="noreferrer"
                className="composer-thumb-in block h-full w-full overflow-hidden rounded-lg shadow-sm ring-1 ring-border/50"
              >
                <img src={att.url} alt={name} className="h-full w-full object-cover" />
              </a>
              {onRemove ? (
                <Button variant="ghost" size="iconSm"
                  type="button"
                  onClick={() => onRemove(att.id)}
                  className="absolute -right-1.5 -top-1.5 bg-bg ring-1 ring-border/60 backdrop-blur-sm group-hover/thumb:opacity-100"
                  aria-label={t('composer.removeAttachment', { name })}
                >
                  <X size={14} />
                </Button>
              ) : null}
            </div>
          )
        })}
        {pending ? (
          <Skeleton className="h-16 w-24 shrink-0 rounded-lg ring-1 ring-border/40" aria-hidden />
        ) : null}
      </div>
    )
  }

  return (
    <div className={`flex flex-wrap gap-2 ${compact ? '' : 'mt-2'}`}>
      {attachments.map((att) => {
        const name = att.name || 'file'
        const isImage = isImageAttachment(att)
        return (
          <div
            key={att.id}
            className={
              isImage
                ? 'relative overflow-hidden rounded-lg border border-border bg-bg-elevated/60'
                : 'relative flex items-center gap-2 rounded-lg border border-border bg-bg-elevated/60 px-2 py-1.5 text-xs'
            }
          >
            {isImage ? (
              <LazyThumb url={att.url} name={name} />
            ) : (
              <a
                href={att.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 text-text-secondary hover:text-text-primary"
              >
                <FileText size={14} />
                <span className="max-w-[140px] truncate-fade">{name}</span>
              </a>
            )}
            {onRemove ? (
              <Pressable
                onClick={() => onRemove(att.id)}
                className={
                  isImage
                    ? 'absolute right-1 top-1 w-auto rounded-md bg-bg p-0.5 text-text-primary hover:bg-bg'
                    : 'w-auto rounded p-0.5 text-text-muted hover:bg-bg-hover hover:text-text-primary'
                }
                aria-label={t('composer.removeAttachment', { name })}
              >
                <X size={14} />
              </Pressable>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
