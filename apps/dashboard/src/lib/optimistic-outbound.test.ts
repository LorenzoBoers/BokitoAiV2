import { describe, expect, it } from 'vitest'
import {
  buildOptimisticOutbound,
  dropMatchedLocals,
  isLocalOutboundId,
  keepPendingLocals,
  replaceLocalWithServer,
} from './optimistic-outbound'
import type { InboxMessage } from './inbox-api'

function serverMsg(partial: Partial<InboxMessage> & { id: string; bodyText: string }): InboxMessage {
  return {
    threadId: 't1',
    connectionId: null,
    direction: 'outbound',
    fromAddress: '',
    toAddresses: '',
    subject: '',
    bodyPreview: partial.bodyText,
    bodyHtml: null,
    graphMessageId: '',
    inReplyTo: null,
    authorUserId: 1,
    isRead: true,
    sendStatus: 'sent',
    attachments: null,
    receivedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...partial,
  }
}

describe('optimistic-outbound', () => {
  it('builds a local sending bubble', () => {
    const msg = buildOptimisticOutbound({
      threadId: 't1',
      bodyText: 'Hallo',
      authorUserId: 7,
    })
    expect(isLocalOutboundId(msg.id)).toBe(true)
    expect(msg.sendStatus).toBe('sending')
    expect(msg.bodyText).toBe('Hallo')
  })

  it('drops matching locals when the server confirms', () => {
    const local = buildOptimisticOutbound({
      threadId: 't1',
      bodyText: 'Hallo',
      authorUserId: 7,
    })
    const confirmed = serverMsg({ id: 'srv-1', bodyText: 'Hallo', authorUserId: 7 })
    const next = dropMatchedLocals([local, confirmed], confirmed)
    expect(next.map((m) => m.id)).toEqual(['srv-1'])
  })

  it('keeps failed locals across a quiet refresh', () => {
    const local = {
      ...buildOptimisticOutbound({
        threadId: 't1',
        bodyText: 'Fail me',
        authorUserId: 7,
      }),
      sendStatus: 'failed:network' as const,
    }
    const serverOnly = [serverMsg({ id: 'old', bodyText: 'Earlier', authorUserId: 2 })]
    const merged = keepPendingLocals([local], serverOnly)
    expect(merged.some((m) => m.id === local.id)).toBe(true)
  })

  it('replaces a local id with the server message', () => {
    const local = buildOptimisticOutbound({
      threadId: 't1',
      bodyText: 'Hi',
      authorUserId: 1,
    })
    const server = serverMsg({ id: 'srv-9', bodyText: 'Hi' })
    const next = replaceLocalWithServer([local], String(local.id), server)
    expect(next).toHaveLength(1)
    expect(next[0].id).toBe('srv-9')
    expect(next[0].sendStatus).toBe('sent')
  })
})
