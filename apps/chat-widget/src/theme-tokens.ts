/**
 * Neutral surface, text and AI colors for the widget, taken from the same
 * palette as the dashboard (`@bokito/ui-tokens`). The brand accent stays
 * tenant-configurable and is applied separately in `brand.ts`.
 */

import { darkColors, fontFamily, lightColors, type ColorScheme, type Rgb } from '@bokito/ui-tokens'

const rgb = (c: Rgb) => `rgb(${c[0]} ${c[1]} ${c[2]})`
const rgba = (c: Rgb, a: number) => `rgb(${c[0]} ${c[1]} ${c[2]} / ${a})`

function neutralVars(c: ColorScheme): string {
  return [
    `--bk-text:${rgb(c.textPrimary)}`,
    `--bk-text-muted:${rgb(c.textSecondary)}`,
    `--bk-bg:${rgb(c.bg)}`,
    `--bk-bg-surface:${rgb(c.bgSurface)}`,
    `--bk-bg-hover:${rgb(c.bgHover)}`,
    `--bk-border:${rgb(c.border)}`,
    `--bk-border-light:${rgba(c.border, 0.6)}`,
    `--bk-popover:${rgb(c.bgSurface)}`,
    `--bk-ai:${rgb(c.ai)}`,
    `--bk-ai-ink:${rgb(c.aiInk)}`,
    `--bk-danger:${rgb(c.statusError)}`,
  ].join(';')
}

export const LIGHT_VARS = neutralVars(lightColors)
export const DARK_VARS = neutralVars(darkColors)
export const DARK_HEADING = rgb(darkColors.textHeading)
export const LIGHT_HEADING = rgb(lightColors.textHeading)

export const FONT_SANS = fontFamily.cssSans
export const FONT_MONO = fontFamily.cssMono
export const FONT_IMPORT =
  "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap');"

export const WIDGET_BG = { light: lightColors.bg, dark: darkColors.bg } as const
