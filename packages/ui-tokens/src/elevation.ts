/** Box-shadows per theme. CSS names are --shadow-* in the generated stylesheet. */

export const elevation = {
  dark: {
    btn: 'none',
    insetHighlight: '0 1px 0 rgba(255, 255, 255, 0.04) inset',
    chipActive: '0 0 0 1px rgb(var(--color-border) / 0.9)',
    card: '0 0 0 0 transparent',
    cardHover: '0 0 0 1px rgb(var(--color-border-light) / 0.9)',
    overlay: '0 0 0 1px rgb(255 255 255 / 0.06), 0 18px 48px -18px rgb(0 0 0 / 0.7)',
    composer: '0 0 0 1px rgb(var(--color-border)), 0 4px 18px -6px rgb(0 0 0 / 0.45)',
  },
  light: {
    btn: 'none',
    insetHighlight: '0 1px 0 rgba(255, 255, 255, 0.6) inset',
    chipActive: '0 0 0 1px rgb(var(--color-border) / 0.9)',
    card: '0 0 0 0 transparent',
    cardHover: '0 0 0 1px rgb(var(--color-border-light) / 0.85)',
    overlay: '0 0 0 1px rgb(30 25 15 / 0.06), 0 16px 40px -16px rgb(30 25 15 / 0.2)',
    composer: '0 0 0 1px rgb(var(--color-border)), 0 4px 16px -8px rgb(30 25 15 / 0.14)',
  },
} as const

export const elevationCssName = {
  btn: 'btn',
  insetHighlight: 'inset-highlight',
  chipActive: 'chip-active',
  card: 'card',
  cardHover: 'card-hover',
  overlay: 'overlay',
  composer: 'composer',
} as const
