import { describe, expect, it } from 'vitest'
import {
  buildTimelineRows,
  eventsShareCluster,
  isSessionCheckoutEcho,
} from '../components/inbox/ThreadTimeline'
import { CHAT_STACK_GAP_MS } from './chat-layout'
import type { InboxEvent, InboxMessage, InboxThread, ThreadDetail } from './inbox-api'

function event(id: string, createdAt: string, eventType = 'assigned'): InboxEvent {
  return {
    id,
    threadId: 't1',
    eventType,
    actorUserId: 1,
    payload: {},
    createdAt,
  }
}

function detail(events: InboxEvent[]): ThreadDetail {
  return {
    thread: { id: 't1' } as InboxThread,
    messages: [],
    events,
    sessions: [],
  }
}

describe('eventsShareCluster', () => {
  it('groups events within the 5 minute chat window', () => {
    expect(
      eventsShareCluster('2026-10-04T12:00:00.000Z', '2026-10-04T12:05:00.000Z'),
    ).toBe(true)
  })

  it('splits events just beyond the window', () => {
    const next = new Date(Date.parse('2026-10-04T12:00:00.000Z') + CHAT_STACK_GAP_MS + 1)
    expect(eventsShareCluster('2026-10-04T12:00:00.000Z', next.toISOString())).toBe(false)
  })
})

describe('buildTimelineRows event clusters', () => {
  const t = (key: string) => key

  it('keeps a burst in one cluster and splits a later burst', () => {
    const rows = buildTimelineRows(
      detail([
        event('1', '2026-10-04T12:00:00.000Z'),
        event('2', '2026-10-04T12:02:00.000Z'),
        event('3', '2026-10-04T12:10:00.000Z'),
        event('4', '2026-10-04T12:11:00.000Z'),
      ]),
      t,
      'en',
    )
    const clusters = rows.filter((row) => row.kind === 'events')
    expect(clusters).toHaveLength(2)
    expect(clusters[0].kind === 'events' && clusters[0].events.map((item) => item.id)).toEqual([
      '1',
      '2',
    ])
    expect(clusters[1].kind === 'events' && clusters[1].events.map((item) => item.id)).toEqual([
      '3',
      '4',
    ])
  })

  it('pins conversation started above a later opening message time', () => {
    const rows = buildTimelineRows(
      detail([
        event('assigned', '2026-10-04T12:00:00.000Z', 'assigned'),
        event('start', '2026-10-04T15:00:00.000Z', 'signal_created'),
      ]),
      t,
      'en',
    )
    const clusters = rows.filter((row) => row.kind === 'events')
    const first = clusters[0]
    expect(first?.kind === 'events' && first.events[0]?.id).toBe('start')
  })
})

describe('isSessionCheckoutEcho', () => {
  const base = {
    id: 'm1',
    threadId: 't1',
    connectionId: null,
    kind: 'user_message',
    direction: 'inbound',
    bodyText: 'End session',
    bodyHtml: null,
    subject: null,
    authorUserId: 1,
    authorAgentId: null,
    authorName: null,
    attachments: null,
    receivedAt: null,
    createdAt: '2026-10-10T14:15:00.000Z',
    payload: {},
  } as InboxMessage

  it('hides checkout button echoes by option id', () => {
    expect(
      isSessionCheckoutEcho({
        ...base,
        decisionResponse: true,
        payload: { decision_response_option_id: 'end_only' },
      }),
    ).toBe(true)
  })

  it('hides older echoes by button label', () => {
    expect(isSessionCheckoutEcho({ ...base, decisionResponse: true })).toBe(true)
  })

  it('keeps normal decision answers', () => {
    expect(
      isSessionCheckoutEcho({
        ...base,
        bodyText: 'Ja',
        decisionResponse: true,
        payload: { decision_response_option_id: 'approve' },
      }),
    ).toBe(false)
  })
})
