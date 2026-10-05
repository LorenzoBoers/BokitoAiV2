import { describe, expect, it } from 'vitest'
import { resolveTimelineLanding, type TimelineRow } from '../components/inbox/ThreadTimeline'
import type { InboxMessage } from './inbox-api'

function msg(
  id: string,
  direction: InboxMessage['direction'],
  kind?: string,
): TimelineRow {
  return {
    kind: 'message',
    id: `m-${id}`,
    time: '2026-10-04T12:00:00.000Z',
    data: {
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
    },
  }
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

  it('opens a new inbound email at the start of that mail', () => {
    const rows = [msg('1', 'outbound'), msg('2', 'inbound')]
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
