/**
 * Durations and easings used by the Tailwind animation utilities.
 * Keyframes stay in the dashboard Tailwind config.
 */

export const motion = {
  duration: {
    120: '120ms',
    160: '160ms',
    180: '180ms',
    220: '220ms',
    240: '240ms',
    280: '280ms',
    340: '340ms',
  },
  easing: {
    out: 'ease-out',
    enter: 'cubic-bezier(0.16, 1, 0.3, 1)',
    exit: 'cubic-bezier(0.4, 0, 1, 1)',
  },
} as const
