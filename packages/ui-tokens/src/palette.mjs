/** Dashboard color tokens. RGB triplets match apps/dashboard CSS variables. */

/** @typedef {[number, number, number]} Rgb */

/**
 * @type {Record<string, { css: string, dark: Rgb, light: Rgb }>}
 */
export const colorTokens = {
  bg: { css: 'bg', dark: [38, 37, 35], light: [251, 250, 246] },
  bgRoot: { css: 'bg-root', dark: [29, 28, 26], light: [243, 241, 234] },
  bgSidebar: { css: 'bg-sidebar', dark: [29, 28, 26], light: [243, 241, 234] },
  bgCanvas: { css: 'bg-canvas', dark: [38, 37, 35], light: [251, 250, 246] },
  bgSurface: { css: 'bg-surface', dark: [45, 44, 41], light: [255, 255, 255] },
  bgElevated: { css: 'bg-elevated', dark: [50, 48, 45], light: [247, 245, 239] },
  bgHover: { css: 'bg-hover', dark: [58, 56, 52], light: [236, 233, 225] },
  bgInput: { css: 'bg-input', dark: [45, 44, 41], light: [255, 255, 255] },
  border: { css: 'border', dark: [61, 59, 55], light: [230, 226, 216] },
  borderLight: { css: 'border-light', dark: [77, 74, 69], light: [214, 209, 196] },
  borderFocus: { css: 'border-focus', dark: [95, 214, 170], light: [12, 125, 86] },
  textPrimary: { css: 'text-primary', dark: [236, 233, 226], light: [41, 38, 31] },
  textSecondary: { css: 'text-secondary', dark: [196, 191, 180], light: [87, 83, 74] },
  textMuted: { css: 'text-muted', dark: [172, 167, 156], light: [107, 102, 92] },
  textHeading: { css: 'text-heading', dark: [247, 245, 240], light: [26, 24, 20] },
  accent: { css: 'accent', dark: [60, 200, 149], light: [12, 125, 86] },
  accentHover: { css: 'accent-hover', dark: [82, 212, 164], light: [10, 109, 75] },
  accentDark: { css: 'accent-dark', dark: [42, 167, 122], light: [8, 93, 64] },
  accentFg: { css: 'accent-fg', dark: [6, 36, 26], light: [255, 255, 255] },
  accentInk: { css: 'accent-ink', dark: [130, 225, 191], light: [9, 104, 72] },
  ai: { css: 'ai', dark: [169, 139, 255], light: [106, 60, 212] },
  aiInk: { css: 'ai-ink', dark: [205, 188, 255], light: [76, 40, 153] },
  aiFg: { css: 'ai-fg', dark: [21, 10, 48], light: [255, 255, 255] },
  statusSuccess: { css: 'status-success', dark: [82, 209, 157], light: [14, 118, 82] },
  statusWarning: { css: 'status-warning', dark: [240, 177, 74], light: [154, 79, 6] },
  statusError: { css: 'status-error', dark: [244, 135, 126], light: [179, 54, 43] },
  statusInfo: { css: 'status-info', dark: [132, 171, 255], light: [40, 86, 194] },
}

export const accentMutedAlpha = { dark: 0.16, light: 0.12 }
