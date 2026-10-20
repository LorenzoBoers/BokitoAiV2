import { describe, expect, it } from 'vitest'
import type { ProposalBundleEntry } from './inbox-api'
import { bundleRowLabel, bundleRowSubtitle, humanizeIsoDatetimes } from './bundleActionLabel'

function entry(partial: Partial<ProposalBundleEntry> & Pick<ProposalBundleEntry, 'decisionId'>): ProposalBundleEntry {
  return {
    cardMessageId: null,
    title: '',
    summary: '',
    status: 'awaiting_human',
    chosenOptionId: null,
    resolvedAt: null,
    approveOptionId: 'approve',
    rejectOptionId: 'reject',
    actionType: 'calendar_create_event',
    action: null,
    learn: null,
    platformChangeId: null,
    items: [],
    ...partial,
  }
}

describe('bundleRowLabel', () => {
  it('prefers decision title over generic calendar fallback', () => {
    const row = entry({
      decisionId: 'd1',
      title: 'Create calendar event: Random afspraak 1',
      summary: 'Random afspraak 1 from 10:30 to 11:30 in Agenda',
      action: {
        tool: 'calendar_create_event',
        key: 'calendar_create_event',
        args: { title: 'Random afspraak 1' },
        fallback: 'Calendar create event',
      },
    })
    expect(bundleRowLabel(row)).toBe('Create calendar event: Random afspraak 1')
  })

  it('strips Approve: prefix from policy titles', () => {
    const row = entry({
      decisionId: 'd2',
      title: 'Approve: Set thread schedule',
      action: {
        tool: 'set_thread_schedule',
        key: 'set_thread_schedule',
        args: {},
        fallback: 'Set thread schedule',
      },
    })
    expect(bundleRowLabel(row)).toBe('Set thread schedule')
  })

  it('uses i18n when a named integration arg is present', () => {
    const row = entry({
      decisionId: 'd3',
      title: 'Connect HubSpot',
      action: {
        tool: 'connect_integration',
        key: 'connect_integration',
        args: { provider: 'HubSpot' },
        fallback: 'Connect HubSpot',
      },
    })
    const label = bundleRowLabel(row, {
      exists: (key) => key === 'communication:actions.connect_integration',
      t: (_key, args) => `Koppel ${args.provider}`,
    })
    expect(label).toBe('Koppel HubSpot')
  })

  it('falls back to action.fallback when title is empty', () => {
    const row = entry({
      decisionId: 'd4',
      title: '',
      action: {
        tool: 'calendar_create_event',
        key: 'calendar_create_event',
        args: {},
        fallback: 'Calendar create event',
      },
    })
    expect(bundleRowLabel(row)).toBe('Calendar create event')
  })
})

describe('bundleRowSubtitle', () => {
  it('uses the first summary line for calendar specifics', () => {
    const row = entry({
      decisionId: 'd1',
      summary: 'Random afspraak 1 · 14 Oct 2026, 10:30–11:30 · Agenda\nMore',
      action: {
        tool: 'calendar_create_event',
        key: 'calendar_create_event',
        args: {},
        fallback: 'Calendar create event',
      },
    })
    expect(bundleRowSubtitle(row)).toBe('Random afspraak 1 · 14 Oct 2026, 10:30–11:30 · Agenda')
  })

  it('humanizes ISO stamps left in older summaries', () => {
    const row = entry({
      decisionId: 'd1b',
      summary: 'Random afspraak 1 from 2026-10-14T10:30:00 to 2026-10-14T11:30:00 in Agenda',
      action: {
        tool: 'calendar_create_event',
        key: 'calendar_create_event',
        args: {},
        fallback: 'Calendar create event',
      },
    })
    const sub = bundleRowSubtitle(row, 'en-GB')
    expect(sub).not.toMatch(/T\d{2}:\d{2}/)
    expect(sub).toContain('Random afspraak 1')
  })

  it('falls back to the tool key when summary is empty', () => {
    const row = entry({
      decisionId: 'd2',
      action: {
        tool: 'calendar_create_event',
        key: 'calendar_create_event',
        args: {},
        fallback: 'Calendar create event',
      },
    })
    expect(bundleRowSubtitle(row)).toBe('calendar_create_event')
  })
})

describe('humanizeIsoDatetimes', () => {
  it('replaces ISO values with a locale datetime', () => {
    const out = humanizeIsoDatetimes('from 2026-10-14T10:30:00 to 2026-10-14T11:30:00', 'en-GB')
    expect(out).not.toContain('T10:30')
    expect(out.toLowerCase()).toMatch(/14/)
  })
})
