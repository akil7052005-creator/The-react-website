import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { Skeleton } from '../ui'

/** A QR code for a link, drawn in the browser, with a PNG download (for printing on cards). */
export function QrCode({ value, fileName, size = 200 }: { value: string; fileName: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    QRCode.toDataURL(value, { width: size * 2, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#2a1e22', light: '#ffffff' } })
      .then((url) => alive && setSrc(url))
      .catch(() => alive && setSrc(null))
    return () => {
      alive = false
    }
  }, [value, size])

  return (
    <figure className="sw-qr">
      {src ? <img src={src} width={size} height={size} alt="QR code for the gallery link" /> : <Skeleton width={size} height={size} radius={12} />}
      <figcaption>
        <a className="btn btn-sm btn-ghost" href={src ?? undefined} download={`${fileName}.png`} aria-disabled={!src}>
          <i className="bi bi-download" /> Download QR
        </a>
      </figcaption>
    </figure>
  )
}
