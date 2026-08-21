/**
 * Applies tenant branding (favicon + brand color) to the dashboard shell.
 *
 * The brand color is written into the `--color-accent*` CSS variables that
 * Tailwind's `accent` palette reads, so every accent-colored element follows
 * the tenant automatically. Values reset to the stylesheet defaults when the
 * tenant has no brand color configured.
 */

const DEFAULT_FAVICON = '/bokito-logo.svg'

function hexToRgb(hex: string): [number, number, number] | null {
  const normalized = hex.trim().replace(/^#/, '')
  const full =
    normalized.length === 3
      ? normalized
          .split('')
          .map((c) => c + c)
          .join('')
      : normalized
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ]
}

function darken(rgb: [number, number, number], factor: number): [number, number, number] {
  return [
    Math.round(rgb[0] * factor),
    Math.round(rgb[1] * factor),
    Math.round(rgb[2] * factor),
  ]
}

export function applyBrandColor(brandColor: string | null | undefined): void {
  const root = document.documentElement
  const rgb = brandColor ? hexToRgb(brandColor) : null
  if (!rgb) {
    root.style.removeProperty('--color-accent')
    root.style.removeProperty('--color-accent-hover')
    root.style.removeProperty('--color-accent-dark')
    return
  }
  root.style.setProperty('--color-accent', rgb.join(' '))
  root.style.setProperty('--color-accent-hover', darken(rgb, 0.9).join(' '))
  root.style.setProperty('--color-accent-dark', darken(rgb, 0.78).join(' '))
}

export function applyFavicon(faviconUrl: string | null | undefined): void {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  const next = faviconUrl || DEFAULT_FAVICON
  if (link.href !== next) {
    link.removeAttribute('type')
    link.href = next
  }
}
