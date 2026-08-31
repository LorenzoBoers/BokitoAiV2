/**
 * Declarative first-run tour definition.
 *
 * Each step points at a `[data-tour="..."]` anchor in the shell. Steps are
 * data, not code: reorder, add or remove entries here and the overlay,
 * progress dots and keyboard navigation follow. Copy lives in the `tour`
 * i18n namespace under `steps.{id}`.
 *
 * Bump TOUR_VERSION when the tour changes enough that existing users should
 * see it again (the auto-start check compares the persisted version).
 */

export const TOUR_VERSION = 1

export type TourStepDef = {
  /** i18n key under `tour:steps.{id}` and stable analytics id. */
  id: string
  /** `[data-tour]` anchor to spotlight. Missing/hidden anchors fall back to a centered card. */
  target: string
  /** Route to navigate to before showing this step (optional). */
  route?: string
  /** Preferred tooltip side relative to the anchor. */
  placement?: 'right' | 'bottom' | 'left' | 'top'
}

export const TOUR_STEPS: readonly TourStepDef[] = [
  {
    id: 'communication',
    target: 'nav-communication',
    route: '/communication/inbox/open',
    placement: 'right',
  },
  { id: 'ai', target: 'nav-group-ai', placement: 'right' },
  { id: 'agenda', target: 'nav-agenda', placement: 'right' },
  { id: 'modules', target: 'nav-modules', placement: 'right' },
  { id: 'settings', target: 'nav-settings', placement: 'right' },
]

/** Pillar cards on the welcome screen, in display order (copy: `tour:welcome.pillars.{id}`). */
export const WELCOME_PILLARS = ['communication', 'ai', 'automations', 'modules', 'control'] as const
