import type { Config } from 'tailwindcss'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  presets: [require('@bokito/ui-tokens/tailwind-preset.generated.cjs')],
  theme: {
    extend: {
      textColor: {
        accent: {
          DEFAULT: 'rgb(var(--color-accent-ink) / <alpha-value>)',
          hover: 'rgb(var(--color-accent-ink) / <alpha-value>)',
          dark: 'rgb(var(--color-accent-ink) / <alpha-value>)',
          fg: 'rgb(var(--color-accent-fg) / <alpha-value>)',
          ink: 'rgb(var(--color-accent-ink) / <alpha-value>)',
        },
      },
      // Soft pill fills (Badge, FilterChip) use /12; not in Tailwind's default scale.
      opacity: {
        12: '0.12',
      },
      // Content widths: PageContent sm/md/lg/xl plus the shell caps.
      maxWidth: {
        form: '40rem', // 640
        reading: '56rem', // 896
        page: '62.5rem', // 1000
        dense: '75rem', // 1200
        shell: '77.5rem', // 1240
        canvas: '112.5rem', // 1800
      },
      width: {
        rail: '14.75rem',
        'rail-collapsed': '3.25rem',
      },
      boxShadow: {
        // Theme-aware elevation tokens (defined per theme in index.css).
        card: 'var(--shadow-card)',
        'card-hover': 'var(--shadow-card-hover)',
        overlay: 'var(--shadow-overlay)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'pop-in': {
          from: { opacity: '0', transform: 'scale(0.97) translateY(4px)' },
          to: { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
        // Dialog variant: keeps the -50%/-50% centering transform intact.
        'dialog-in': {
          from: { opacity: '0', transform: 'translate(-50%, -48.5%) scale(0.97)' },
          to: { opacity: '1', transform: 'translate(-50%, -50%) scale(1)' },
        },
        'page-enter': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'content-enter': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-left': {
          from: { opacity: '0', transform: 'translateX(-12px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        // Right-hand side panel (SidePanel) slides in from the edge.
        'panel-in': {
          from: { opacity: '0', transform: 'translateX(24px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        'list-row-enter': {
          from: { opacity: '0', transform: 'translateX(-4px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        // Popover swap: opacity and scale only, so layout does not stretch.
        'issues-in': {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'issues-out': {
          from: { opacity: '1', transform: 'scale(1)' },
          to: { opacity: '0', transform: 'scale(0.96)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 180ms ease-out',
        'pop-in': 'pop-in 220ms cubic-bezier(0.16, 1, 0.3, 1)',
        'dialog-in': 'dialog-in 220ms cubic-bezier(0.16, 1, 0.3, 1)',
        'page-enter': 'page-enter 340ms cubic-bezier(0.16, 1, 0.3, 1)',
        'content-enter': 'content-enter 280ms cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-in-left': 'slide-in-left 240ms cubic-bezier(0.16, 1, 0.3, 1)',
        'panel-in': 'panel-in 240ms cubic-bezier(0.16, 1, 0.3, 1)',
        'list-row-enter': 'list-row-enter 280ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'issues-in': 'issues-in 160ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'issues-out': 'issues-out 120ms cubic-bezier(0.4, 0, 1, 1) both',
      },
    },
  },
  plugins: [],
} satisfies Config
