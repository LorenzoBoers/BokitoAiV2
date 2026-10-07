import { describe, expect, it } from 'vitest'
import {
  resolveTimelineLanding,
  trailingUnreadInboundIds,
  type TimelineRow,
} from '../components/inbox/ThreadTimeline'
import type { InboxMessage } from './inbox-api'

function inboxMsg(
  id: string,
  direction: InboxMessage['direction'],
  kind?: string,
): InboxMessage {
  return {
    id,
    threadId: 't1',
    connectionId: null,
    kind,
    direction,
    fromAddress: 'a@b.c',
    toAddresses: 'x@y.z',
    subject: 'Hi',
    bodyPreview: 'Hi',
    bodyHtml: null,
    graphMessageId: id,
    inReplyTo: null,
    authorUserId: null,
    isRead: false,
    sendStatus: null,
    attachments: null,
    receivedAt: null,
    createdAt: '2026-10-04T12:00:00.000Z',
  }
}

function msg(
  id: string,
  direction: InboxMessage['direction'],
  kind?: string,
): TimelineRow {
  return {
    kind: 'message',
    id: `m-${id}`,
    time: '2026-10-04T12:00:00.000Z',
    data: inboxMsg(id, direction, kind),
  }
}

function day(label = 'Yesterday'): TimelineRow {
  return { kind: 'day', id: 'd-1', time: '2026-10-04T00:00:00.000Z', label }
}

describe('resolveTimelineLanding', () => {
  it('opens chat threads at the bottom', () => {
    const rows = [msg('1', 'inbound'), msg('2', 'outbound')]
    expect(resolveTimelineLanding(rows, 3, { focusedMessageId: null, messageLayout: 'chat' })).toEqual({
      index: 3,
      align: 'end',
      pinToBottom: true,
    })
  })

  it('opens a new inbound email at the day pill above that mail', () => {
    const rows = [msg('1', 'outbound'), day(), msg('2', 'inbound')]
    expect(resolveTimelineLanding(rows, 3, { focusedMessageId: null, messageLayout: 'email' })).toEqual({
      index: 1,
      align: 'start',
      pinToBottom: false,
    })
  })

  it('skips notes after a new inbound email and still lands on the mail', () => {
    const rows = [msg('1', 'inbound'), msg('2', 'internal', 'internal_note')]
    expect(resolveTimelineLanding(rows, 3, { focusedMessageId: null, messageLayout: 'email' })).toEqual({
      index: 0,
      align: 'start',
      pinToBottom: false,
    })
  })

  it('opens an email thread at the bottom after an outbound reply', () => {
    const rows = [msg('1', 'inbound'), msg('2', 'outbound')]
    expect(resolveTimelineLanding(rows, 3, { focusedMessageId: null, messageLayout: 'email' })).toEqual({
      index: 3,
      align: 'end',
      pinToBottom: true,
    })
  })

  it('centers a deep-linked message', () => {
    const rows = [msg('1', 'inbound'), msg('2', 'inbound')]
    expect(
      resolveTimelineLanding(rows, 3, { focusedMessageId: '1', messageLayout: 'email' }),
    ).toEqual({
      index: 0,
      align: 'center',
      pinToBottom: false,
    })
  })
})

describe('trailingUnreadInboundIds', () => {
  it('returns the trailing inbound cluster after the last outbound', () => {
    const messages = [inboxMsg('1', 'outbound'), inboxMsg('2', 'inbound'), inboxMsg('3', 'inbound')]
    expect(trailingUnreadInboundIds(messages)).toEqual(['2', '3'])
  })

  it('skips trailing notes when collecting unread inbound', () => {
    const messages = [inboxMsg('1', 'inbound'), inboxMsg('2', 'internal', 'internal_note')]
    expect(trailingUnreadInboundIds(messages)).toEqual(['1'])
  })

  it('returns nothing when the thread ends on an outbound reply', () => {
    const messages = [inboxMsg('1', 'inbound'), inboxMsg('2', 'outbound')]
    expect(trailingUnreadInboundIds(messages)).toEqual([])
  })
})
