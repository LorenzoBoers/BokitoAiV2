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

/**
 * Center-crop to a square, scale to at most PROFILE_PHOTO_MAX_EDGE, encode as
 * JPEG (or WebP when smaller). Phone camera files become upload-ready.
 */
export async function prepareProfilePhoto(file: File): Promise<File> {
  if (!file || file.size <= 0) {
    throw new PrepareProfilePhotoError('empty', 'Empty file')
  }
  if (file.size > PROFILE_PHOTO_MAX_INPUT_BYTES) {
    throw new PrepareProfilePhotoError('too_large', 'File too large')
  }
  if (!looksLikeImage(file)) {
    throw new PrepareProfilePhotoError('unsupported', 'Unsupported image type')
  }

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

  const side = Math.min(srcW, srcH)
  const sx = Math.floor((srcW - side) / 2)
  const sy = Math.floor((srcH - side) / 2)
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
