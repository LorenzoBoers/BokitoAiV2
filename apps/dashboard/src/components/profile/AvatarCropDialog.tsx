import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Minus, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import {
  AVATAR_CROP_VIEWPORT,
  avatarCropFrame,
  type ProfilePhotoCrop,
} from '../../lib/prepare-profile-photo'

const STAGE = 320
const VIEW = AVATAR_CROP_VIEWPORT
const PAD = (STAGE - VIEW) / 2
const ZOOM_MAX = 3

type Props = {
  file: File | null
  busy?: boolean
  onClose: () => void
  onConfirm: (crop: ProfilePhotoCrop) => void
}

export function AvatarCropDialog({ file, busy = false, onClose, onConfirm }: Props) {
  const { t } = useTranslation('profile')
  const stageRef = useRef<HTMLDivElement>(null)
  const [src, setSrc] = useState<string | null>(null)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)

  useEffect(() => {
    if (!file) {
      setSrc(null)
      setNatural(null)
      return
    }
    const url = URL.createObjectURL(file)
    setSrc(url)
    setZoom(1)
    setOffset({ x: 0, y: 0 })
    setNatural(null)
    return () => URL.revokeObjectURL(url)
  }, [file])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const delta = event.deltaY > 0 ? -0.08 : 0.08
      setZoom((current) => Math.min(ZOOM_MAX, Math.max(1, current + delta)))
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [src])

  const frame = useMemo(() => {
    if (!natural) return null
    return avatarCropFrame({
      srcW: natural.w,
      srcH: natural.h,
      zoom,
      offsetX: offset.x,
      offsetY: offset.y,
    })
  }, [natural, zoom, offset])

  const nudgeZoom = (delta: number) => {
    setZoom((current) => Math.min(ZOOM_MAX, Math.max(1, current + delta)))
  }

  return (
    <Dialog
      open={file != null}
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('personalInformation.cropTitle')}</DialogTitle>
          <DialogDescription>{t('personalInformation.cropHint')}</DialogDescription>
        </DialogHeader>
        <div
          ref={stageRef}
          className="relative mx-auto h-80 w-80 cursor-grab touch-none overflow-hidden rounded-lg bg-bg-elevated active:cursor-grabbing"
          onPointerDown={(event) => {
            if (!frame) return
            event.currentTarget.setPointerCapture(event.pointerId)
            drag.current = { x: event.clientX, y: event.clientY, ox: frame.offsetX, oy: frame.offsetY }
          }}
          onPointerMove={(event) => {
            const start = drag.current
            if (!start) return
            setOffset({
              x: start.ox + (event.clientX - start.x),
              y: start.oy + (event.clientY - start.y),
            })
          }}
          onPointerUp={() => {
            drag.current = null
          }}
          onPointerCancel={() => {
            drag.current = null
          }}
        >
          {src ? (
            <img
              src={src}
              alt=""
              draggable={false}
              onLoad={(event) => {
                const img = event.currentTarget
                if (img.naturalWidth < 8 || img.naturalHeight < 8) {
                  toast.error(t('errors.uploadAvatarUnsupported'))
                  onClose()
                  return
                }
                setNatural({ w: img.naturalWidth, h: img.naturalHeight })
              }}
              onError={() => {
                toast.error(t('errors.uploadAvatarUnsupported'))
                onClose()
              }}
              className="pointer-events-none absolute max-w-none select-none"
              style={
                frame
                  ? {
                      width: frame.dispW,
                      height: frame.dispH,
                      left: PAD + frame.left,
                      top: PAD + frame.top,
                    }
                  : { visibility: 'hidden' }
              }
            />
          ) : null}
          <div
            aria-hidden
            className="pointer-events-none absolute rounded-full ring-2 ring-white/90"
            style={{
              width: VIEW,
              height: VIEW,
              left: PAD,
              top: PAD,
              boxShadow: '0 0 0 999px rgba(0, 0, 0, 0.55)',
            }}
          />
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" size="icon" variant="ghost" aria-label={t('personalInformation.cropZoomOut')} onClick={() => nudgeZoom(-0.15)} disabled={busy}>
            <Minus size={14} />
          </Button>
          <label className="flex min-w-0 flex-1 items-center gap-2 text-xs text-text-muted">
            <span className="sr-only">{t('personalInformation.cropZoom')}</span>
            <input // design-system-ignore: native zoom slider; Input would wrap it in a text field
              type="range"
              min={1}
              max={ZOOM_MAX}
              step={0.01}
              value={zoom}
              disabled={busy}
              aria-label={t('personalInformation.cropZoom')}
              onChange={(event) => setZoom(Number(event.target.value))}
              className="w-full accent-accent"
            />
          </label>
          <Button type="button" size="icon" variant="ghost" aria-label={t('personalInformation.cropZoomIn')} onClick={() => nudgeZoom(0.15)} disabled={busy}>
            <Plus size={14} />
          </Button>
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
            {t('personalInformation.cancelEdit')}
          </Button>
          <Button
            type="button"
            disabled={busy || !frame}
            onClick={() => {
              if (!frame) return
              onConfirm({ sx: frame.sx, sy: frame.sy, side: frame.side })
            }}
          >
            {busy ? t('personalInformation.saving') : t('personalInformation.cropUse')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
