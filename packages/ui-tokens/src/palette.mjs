/** Dashboard color tokens. RGB triplets match apps/dashboard CSS variables. */

/** @typedef {[number, number, number]} Rgb */

/**
 * @type {Record<string, { css: string, dark: Rgb, light: Rgb }>}
 */
export const colorTokens = {
  bg: { css: 'bg', dark: [18, 18, 19], light: [247, 247, 246] },
  bgRoot: { css: 'bg-root', dark: [18, 18, 19], light: [247, 247, 246] },
  bgSidebar: { css: 'bg-sidebar', dark: [18, 18, 19], light: [247, 247, 246] },
  bgCanvas: { css: 'bg-canvas', dark: [18, 18, 19], light: [247, 247, 246] },
  bgSurface: { css: 'bg-surface', dark: [25, 25, 27], light: [255, 255, 255] },
  bgElevated: { css: 'bg-elevated', dark: [30, 30, 33], light: [243, 243, 242] },
  bgHover: { css: 'bg-hover', dark: [38, 38, 42], light: [238, 238, 236] },
  bgInput: { css: 'bg-input', dark: [30, 30, 33], light: [255, 255, 255] },
  border: { css: 'border', dark: [44, 44, 49], light: [232, 232, 229] },
  borderLight: { css: 'border-light', dark: [62, 62, 68], light: [220, 220, 216] },
  borderFocus: { css: 'border-focus', dark: [50, 191, 142], light: [20, 166, 116] },
  textPrimary: { css: 'text-primary', dark: [226, 226, 224], light: [30, 30, 28] },
  textSecondary: { css: 'text-secondary', dark: [168, 168, 166], light: [86, 86, 82] },
  textMuted: { css: 'text-muted', dark: [122, 122, 120], light: [124, 124, 118] },
  textHeading: { css: 'text-heading', dark: [245, 245, 243], light: [14, 14, 13] },
  accent: { css: 'accent', dark: [50, 191, 142], light: [20, 166, 116] },
  accentHover: { css: 'accent-hover', dark: [62, 205, 156], light: [15, 148, 103] },
  accentDark: { css: 'accent-dark', dark: [40, 160, 118], light: [12, 128, 89] },
  accentFg: { css: 'accent-fg', dark: [255, 255, 255], light: [255, 255, 255] },
  accentInk: { css: 'accent-ink', dark: [110, 220, 180], light: [8, 112, 78] },
  ai: { css: 'ai', dark: [139, 92, 246], light: [109, 40, 217] },
  aiInk: { css: 'ai-ink', dark: [196, 181, 253], light: [76, 29, 149] },
  aiFg: { css: 'ai-fg', dark: [255, 255, 255], light: [255, 255, 255] },
  statusSuccess: { css: 'status-success', dark: [52, 199, 141], light: [22, 163, 113] },
  statusWarning: { css: 'status-warning', dark: [236, 165, 48], light: [217, 119, 6] },
  statusError: { css: 'status-error', dark: [232, 96, 100], light: [220, 38, 38] },
  statusInfo: { css: 'status-info', dark: [96, 150, 255], light: [37, 99, 235] },
}

export const accentMutedAlpha = { dark: 0.16, light: 0.12 }
