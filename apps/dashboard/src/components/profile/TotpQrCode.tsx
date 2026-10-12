import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

/** Client-side QR for otpauth:// URIs — secret never leaves the browser. */
export function TotpQrCode({
  value,
  size = 180,
  label,
}: {
  value: string
  size?: number
  label: string
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setDataUrl(null)
    void QRCode.toDataURL(value, {
      width: size,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#0a0a0a', light: '#ffffff' },
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url)
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null)
      })
    return () => {
      cancelled = true
    }
  }, [value, size])

  if (!dataUrl) {
    return (
      <div
        className="rounded-lg border border-border/60 bg-bg-elevated"
        style={{ width: size, height: size }}
        aria-hidden
      />
    )
  }

  return (
    <img
      src={dataUrl}
      alt={label}
      width={size}
      height={size}
      className="rounded-lg border border-border/60 bg-white p-1"
    />
  )
}
