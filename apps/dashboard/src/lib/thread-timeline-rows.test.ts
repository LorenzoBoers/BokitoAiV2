import { describe, expect, it } from 'vitest'
import {
  buildTimelineRows,
  eventsShareCluster,
  isHiddenDecisionResponse,
  isSessionCheckoutCard,
  syntheticDecisionAnswers,
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

function detail(events: InboxEvent[], messages: InboxMessage[] = []): ThreadDetail {
  return {
    thread: { id: 't1' } as InboxThread,
    messages,
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

  it('keeps human ticket actions separate from an earlier agent no-reply', () => {
    const rows = buildTimelineRows(
      detail([
        {
          id: 'nr',
          threadId: 't1',
          eventType: 'no_reply_noted',
          actorType: 'agent',
          actorUserId: null,
          actorAgentId: 'a1',
          payload: {},
          createdAt: '2026-10-04T12:00:00.000Z',
        },
        {
          id: 'cat',
          threadId: 't1',
          eventType: 'category_set',
          actorType: 'user',
          actorUserId: 7,
          payload: { category: 'bug', proposed: false },
          createdAt: '2026-10-04T12:01:00.000Z',
        },
        {
          id: 'stage',
          threadId: 't1',
          eventType: 'ticket_stage_changed',
          actorType: 'user',
          actorUserId: 7,
          payload: { to_stage: 'Open', to_key: 'open', to_kind: 'open' },
          createdAt: '2026-10-04T12:01:01.000Z',
        },
      ]),
      t,
      'en',
    )
    const clusters = rows.filter((row) => row.kind === 'events')
    expect(clusters).toHaveLength(2)
    expect(clusters[0].kind === 'events' && clusters[0].events.map((item) => item.id)).toEqual([
      'nr',
    ])
    expect(clusters[1].kind === 'events' && clusters[1].events.map((item) => item.id)).toEqual([
      'cat',
      'stage',
    ])
  })

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

  it('hides a legacy decision_response bubble when the cloud covers it', () => {
    const card = {
      id: 'c1',
      threadId: 't1',
      kind: 'agent_message',
      createdAt: '2026-10-10T14:14:00.000Z',
      proposal: {
        decisionId: 'd1',
        cardMessageId: 'c1',
        status: 'rejected',
        question: null,
        selection: 'single' as const,
        options: [],
        items: [],
        chosenOptionId: 'reject',
        chosenOptionIds: ['reject'],
        resolvedAt: '2026-10-10T14:15:00.000Z',
        resolvedBy: 'Lorenzo',
        resolvedByUserId: null,
        bundle: [],
        bundleId: null,
      },
    } as unknown as InboxMessage
    const answer = {
      id: 'm-answer',
      threadId: 't1',
      kind: 'user_message',
      bodyText: 'Afgewezen: Approve',
      createdAt: '2026-10-10T14:15:00.000Z',
      decisionResponse: true,
      decisionResponseDecisionId: 'd1',
      payload: {},
    } as unknown as InboxMessage
    const rows = buildTimelineRows(
      detail(
        [
          {
            ...event('dec', '2026-10-10T14:15:01.000Z', 'decision_rejected'),
            payload: { decision_id: 'd1' },
          },
        ],
        [card, answer],
      ),
      t,
      'en',
    )
    const messages = rows.filter((row) => row.kind === 'message')
    expect(messages.some((row) => row.kind === 'message' && row.data.id === 'm-answer')).toBe(
      false,
    )
    expect(rows.some((row) => row.kind === 'events')).toBe(false)
  })
})

describe('syntheticDecisionAnswers', () => {
  const t = (key: string) => key

  it('never rebuilds operator answer bubbles', () => {
    const card = {
      id: 'c1',
      threadId: 't1',
      kind: 'decision_request',
      decisionId: 'd-idle',
      createdAt: '2026-10-12T16:00:00.000Z',
      payload: {
        decision: {
          status: 'approved',
          chosen_option_id: 'end_only',
          options: [{ id: 'end_only', label: 'Sessie afronden', action_type: 'session_checkout' }],
        },
      },
    } as unknown as InboxMessage
    expect(syntheticDecisionAnswers([card], 't1', t)).toHaveLength(0)
  })
})

describe('isHiddenDecisionResponse', () => {
  it('hides when the decision id is on a proposal cloud', () => {
    const answer = {
      decisionResponse: true,
      decisionResponseDecisionId: 'd1',
    } as unknown as InboxMessage
    expect(isHiddenDecisionResponse(answer, new Set(['d1']))).toBe(true)
    expect(isHiddenDecisionResponse(answer, new Set(['other']))).toBe(false)
  })
})

describe('isSessionCheckoutCard', () => {
  it('recognizes leftover wrap-up cards', () => {
    expect(
      isSessionCheckoutCard({
        id: 'd1',
        threadId: 't1',
        connectionId: null,
        kind: 'decision_request',
        direction: 'internal',
        bodyText: 'Sessie afronden?',
        bodyHtml: null,
        subject: null,
        authorUserId: null,
        authorAgentId: null,
        authorName: null,
        attachments: null,
        receivedAt: null,
        createdAt: '2026-10-12T16:00:00.000Z',
        payload: {
          options: [
            {
              id: 'end_only',
              label: 'Sessie afronden',
              action_type: 'session_checkout',
              payload: { session_checkout: true, kind: 'end_only' },
            },
          ],
        },
      } as unknown as InboxMessage),
    ).toBe(true)
  })

  it('keeps other decision cards', () => {
    expect(
      isSessionCheckoutCard({
        id: 'd2',
        threadId: 't1',
        connectionId: null,
        kind: 'decision_request',
        direction: 'internal',
        bodyText: 'Regel toepassen?',
        bodyHtml: null,
        subject: null,
        authorUserId: null,
        authorAgentId: null,
        authorName: null,
        attachments: null,
        receivedAt: null,
        createdAt: '2026-10-12T16:00:00.000Z',
        payload: {
          options: [{ id: 'approve', label: 'Toepassen', action_type: 'create_inbox_rule' }],
        },
      } as unknown as InboxMessage),
    ).toBe(false)
  })
})
