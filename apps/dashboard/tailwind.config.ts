import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: 'rgb(var(--color-bg) / <alpha-value>)',
          root: 'rgb(var(--color-bg-root) / <alpha-value>)',
          sidebar: 'rgb(var(--color-bg-sidebar) / <alpha-value>)',
          canvas: 'rgb(var(--color-bg-canvas) / <alpha-value>)',
          surface: 'rgb(var(--color-bg-surface) / <alpha-value>)',
          elevated: 'rgb(var(--color-bg-elevated) / <alpha-value>)',
          muted: 'rgb(var(--color-bg-hover) / <alpha-value>)',
          hover: 'rgb(var(--color-bg-hover) / <alpha-value>)',
          input: 'rgb(var(--color-bg-input) / <alpha-value>)',
        },
        border: {
          DEFAULT: 'rgb(var(--color-border) / <alpha-value>)',
          light: 'rgb(var(--color-border-light) / <alpha-value>)',
          focus: 'rgb(var(--color-border-focus) / <alpha-value>)',
        },
        text: {
          primary: 'rgb(var(--color-text-primary) / <alpha-value>)',
          secondary: 'rgb(var(--color-text-secondary) / <alpha-value>)',
          muted: 'rgb(var(--color-text-muted) / <alpha-value>)',
          heading: 'rgb(var(--color-text-heading) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--color-accent) / <alpha-value>)',
          hover: 'rgb(var(--color-accent-hover) / <alpha-value>)',
          dark: 'rgb(var(--color-accent-dark) / <alpha-value>)',
          fg: 'rgb(var(--color-accent-fg) / <alpha-value>)',
          ink: 'rgb(var(--color-accent-ink) / <alpha-value>)',
          muted: 'rgb(var(--color-accent) / 0.14)',
          subtle: 'rgb(var(--color-accent) / 0.08)',
        },
        ai: {
          DEFAULT: 'rgb(var(--color-ai) / <alpha-value>)',
          ink: 'rgb(var(--color-ai-ink) / <alpha-value>)',
          fg: 'rgb(var(--color-ai-fg) / <alpha-value>)',
        },
        status: {
          success: 'rgb(var(--color-status-success) / <alpha-value>)',
          warning: 'rgb(var(--color-status-warning) / <alpha-value>)',
          error: 'rgb(var(--color-status-error) / <alpha-value>)',
          info: 'rgb(var(--color-status-info) / <alpha-value>)',
        },
      },
      textColor: {
        accent: {
          DEFAULT: 'rgb(var(--color-accent-ink) / <alpha-value>)',
          hover: 'rgb(var(--color-accent-ink) / <alpha-value>)',
          dark: 'rgb(var(--color-accent-ink) / <alpha-value>)',
          fg: 'rgb(var(--color-accent-fg) / <alpha-value>)',
          ink: 'rgb(var(--color-accent-ink) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: 'var(--font-sans)',
        mono: 'var(--font-mono)',
      },
      // Compact UI scale: 13px body, 11.5px secondary. Headings stay editorial
      // via tracking, not size. Keep 3xl+ at Tailwind defaults.
      fontSize: {
        '2xs': ['0.656rem', { lineHeight: '0.875rem' }], // 10.5 / 14
        xs: ['0.719rem', { lineHeight: '1rem' }], // 11.5 / 16
        sm: ['0.781rem', { lineHeight: '1.125rem' }], // 12.5 / 18
        base: ['0.844rem', { lineHeight: '1.25rem' }], // 13.5 / 20
        lg: ['0.938rem', { lineHeight: '1.375rem' }], // 15 / 22
        xl: ['1.063rem', { lineHeight: '1.5rem', letterSpacing: '-0.01em' }], // 17 / 24
        '2xl': ['1.25rem', { lineHeight: '1.75rem', letterSpacing: '-0.015em' }], // 20 / 28
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
        'list-row-enter': {
          from: { opacity: '0', transform: 'translateX(-4px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 180ms ease-out',
        'pop-in': 'pop-in 220ms cubic-bezier(0.16, 1, 0.3, 1)',
        'dialog-in': 'dialog-in 220ms cubic-bezier(0.16, 1, 0.3, 1)',
        'page-enter': 'page-enter 340ms cubic-bezier(0.16, 1, 0.3, 1)',
        'content-enter': 'content-enter 280ms cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-in-left': 'slide-in-left 240ms cubic-bezier(0.16, 1, 0.3, 1)',
        'list-row-enter': 'list-row-enter 280ms cubic-bezier(0.16, 1, 0.3, 1) both',
      },
    },
  },
  plugins: [],
} satisfies Config
