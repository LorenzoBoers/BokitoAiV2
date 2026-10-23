/** Box-shadows per theme. CSS names are --shadow-* in the generated stylesheet. */

export const elevation = {
  dark: {
    btn: '0 1px 0 rgba(255, 255, 255, 0.06) inset',
    insetHighlight: '0 1px 0 rgba(255, 255, 255, 0.04) inset',
    chipActive: '0 0 0 1px rgb(var(--color-border) / 0.9)',
    card: '0 0 0 0 transparent',
    cardHover: '0 0 0 1px rgb(var(--color-border-light) / 0.9)',
    overlay:
      '0 0 0 1px rgba(255, 255, 255, 0.04), 0 16px 48px -16px rgba(0, 0, 0, 0.7)',
  },
  light: {
    btn: '0 1px 0 rgba(255, 255, 255, 0.18) inset, 0 1px 2px rgba(20, 20, 18, 0.12)',
    insetHighlight: '0 1px 0 rgba(255, 255, 255, 0.6) inset',
    chipActive: '0 0 0 1px rgb(var(--color-border) / 0.9)',
    card: '0 1px 0 rgba(20, 20, 18, 0.02)',
    cardHover: '0 0 0 1px rgb(var(--color-border-light) / 0.85)',
    overlay:
      '0 0 0 1px rgba(24, 24, 22, 0.035), 0 12px 32px -12px rgba(24, 24, 22, 0.14)',
  },
} as const

export const elevationCssName = {
  btn: 'btn',
  insetHighlight: 'inset-highlight',
  chipActive: 'chip-active',
  card: 'card',
  cardHover: 'card-hover',
  overlay: 'overlay',
} as const
