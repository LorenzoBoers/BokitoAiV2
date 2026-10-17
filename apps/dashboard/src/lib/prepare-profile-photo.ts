/** Client-side prepare for profile photos: square crop + compress. */

export const PROFILE_PHOTO_MAX_INPUT_BYTES = 20 * 1024 * 1024
export const PROFILE_PHOTO_MAX_EDGE = 512
/** Stay comfortably under the API avatar limit after base64 storage. */
export const PROFILE_PHOTO_TARGET_BYTES = 400_000

const ACCEPT_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
])

export type PrepareProfilePhotoErrorCode =
  | 'empty'
  | 'too_large'
  | 'unsupported'
  | 'decode'
  | 'encode'

export class PrepareProfilePhotoError extends Error {
  code: PrepareProfilePhotoErrorCode

  constructor(code: PrepareProfilePhotoErrorCode, message: string) {
    super(message)
    this.name = 'PrepareProfilePhotoError'
    this.code = code
  }
}

function looksLikeImage(file: File): boolean {
  if (file.type && ACCEPT_MIME.has(file.type.toLowerCase())) return true
  if (file.type && file.type.startsWith('image/')) return true
  return /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(file.name)
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new PrepareProfilePhotoError('decode', 'Could not decode image'))
    }
    img.src = url
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new PrepareProfilePhotoError('encode', 'Could not encode image'))
          return
        }
        resolve(blob)
      },
      type,
      quality,
    )
  })
}

/** Square taken from the source image, in source pixels. */
export type ProfilePhotoCrop = {
  sx: number
  sy: number
  side: number
}

/** Circle the operator frames in the crop dialog, in CSS pixels. */
export const AVATAR_CROP_VIEWPORT = 260

export type AvatarCropFrame = ProfilePhotoCrop & {
  offsetX: number
  offsetY: number
  dispW: number
  dispH: number
  /** Image origin inside the viewport box. */
  left: number
  top: number
}

/**
 * Map a pan/zoom in the crop viewport back to a source square.
 * Zoom 1 covers the circle with the shorter side. Offset is clamped so the
 * circle never shows empty space.
 */
export function avatarCropFrame(input: {
  srcW: number
  srcH: number
  viewport?: number
  zoom: number
  offsetX: number
  offsetY: number
}): AvatarCropFrame {
  const viewport = input.viewport ?? AVATAR_CROP_VIEWPORT
  const srcW = Math.max(1, input.srcW)
  const srcH = Math.max(1, input.srcH)
  const zoom = Math.max(1, input.zoom)
  const minSide = Math.min(srcW, srcH)
  const displayScale = (viewport / minSide) * zoom
  const dispW = srcW * displayScale
  const dispH = srcH * displayScale
  const maxX = Math.max(0, (dispW - viewport) / 2)
  const maxY = Math.max(0, (dispH - viewport) / 2)
  const offsetX = Math.max(-maxX, Math.min(maxX, input.offsetX))
  const offsetY = Math.max(-maxY, Math.min(maxY, input.offsetY))
  const left = (viewport - dispW) / 2 + offsetX
  const top = (viewport - dispH) / 2 + offsetY
  const side = viewport / displayScale
  return {
    sx: (0 - left) / displayScale,
    sy: (0 - top) / displayScale,
    side,
    offsetX,
    offsetY,
    dispW,
    dispH,
    left,
    top,
  }
}

function resolveCrop(
  srcW: number,
  srcH: number,
  crop?: ProfilePhotoCrop | null,
): { sx: number; sy: number; side: number } {
  if (!crop || !(crop.side > 0)) {
    const side = Math.min(srcW, srcH)
    return {
      sx: (srcW - side) / 2,
      sy: (srcH - side) / 2,
      side,
    }
  }
  const side = Math.min(crop.side, srcW, srcH)
  return {
    sx: Math.max(0, Math.min(crop.sx, srcW - side)),
    sy: Math.max(0, Math.min(crop.sy, srcH - side)),
    side,
  }
}

/** Reject a file before the crop dialog opens. */
export function assertProfilePhotoFile(file: File): void {
  if (!file || file.size <= 0) {
    throw new PrepareProfilePhotoError('empty', 'Empty file')
  }
  if (file.size > PROFILE_PHOTO_MAX_INPUT_BYTES) {
    throw new PrepareProfilePhotoError('too_large', 'File too large')
  }
  if (!looksLikeImage(file)) {
    throw new PrepareProfilePhotoError('unsupported', 'Unsupported image type')
  }
}

/**
 * Crop to a square (the operator's frame, or the center when omitted), scale
 * to at most PROFILE_PHOTO_MAX_EDGE, encode as JPEG. Phone camera files
 * become upload-ready.
 */
export async function prepareProfilePhoto(file: File, crop?: ProfilePhotoCrop | null): Promise<File> {
  assertProfilePhotoFile(file)

  let img: HTMLImageElement
  try {
    img = await loadImage(file)
  } catch (err) {
    if (err instanceof PrepareProfilePhotoError) throw err
    throw new PrepareProfilePhotoError('decode', 'Could not decode image')
  }

  const srcW = img.naturalWidth || img.width
  const srcH = img.naturalHeight || img.height
  if (srcW < 8 || srcH < 8) {
    throw new PrepareProfilePhotoError('decode', 'Image too small')
  }

  const framed = resolveCrop(srcW, srcH, crop)
  const side = framed.side
  const sx = framed.sx
  const sy = framed.sy
  const edge = Math.min(PROFILE_PHOTO_MAX_EDGE, side)

  const canvas = document.createElement('canvas')
  canvas.width = edge
  canvas.height = edge
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new PrepareProfilePhotoError('encode', 'Could not create canvas')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, sx, sy, side, side, 0, 0, edge, edge)

  // Prefer JPEG for photos; retry with lower quality until under target.
  let quality = 0.9
  let blob = await canvasToBlob(canvas, 'image/jpeg', quality)
  while (blob.size > PROFILE_PHOTO_TARGET_BYTES && quality > 0.55) {
    quality -= 0.08
    blob = await canvasToBlob(canvas, 'image/jpeg', quality)
  }

  // Tiny PNG/GIF icons: keep PNG if JPEG somehow grew (rare for photos).
  if (file.type === 'image/png' && file.size <= PROFILE_PHOTO_TARGET_BYTES && blob.size > file.size) {
    const pngBlob = await canvasToBlob(canvas, 'image/png', 1)
    if (pngBlob.size < blob.size) blob = pngBlob
  }

  if (blob.size > PROFILE_PHOTO_TARGET_BYTES * 1.5) {
    throw new PrepareProfilePhotoError('too_large', 'Could not compress image enough')
  }

  const ext = blob.type === 'image/png' ? 'png' : 'jpg'
  const base = (file.name.replace(/\.[^.]+$/, '') || 'avatar').slice(0, 64)
  return new File([blob], `${base}.${ext}`, { type: blob.type, lastModified: Date.now() })
}
