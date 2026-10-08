import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearStoredMailDraft,
  mailDraftHasContent,
  mailDraftStorageKey,
  readStoredMailDraft,
  writeStoredMailDraft,
  type StoredMailDraft,
} from './mail-draft-store'
import type { MessageAttachment } from './inbox-api'

const store = new Map<string, string>()

beforeEach(() => {
  store.clear()
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const attachment: MessageAttachment = {
  id: 'att-1',
  name: 'offerte.pdf',
  mime: 'application/pdf',
  size: 1234,
  url: '/api/uploads/files/t1/offerte.pdf',
}

function draftOf(overrides: Partial<StoredMailDraft> = {}): StoredMailDraft {
  return {
    mode: 'reply',
    sourceMessageId: 'msg-9',
    to: 'harold@example.com',
    cc: '',
    bcc: '',
    subject: 'Re: Offerte',
    body: 'Dag Harold,',
    attachments: [],
    channelAccountId: 'chan-1',
    updatedAt: '2026-10-08T12:00:00Z',
    ...overrides,
  }
}

describe('mail-draft-store', () => {
  it('round-trips a draft per thread', () => {
    writeStoredMailDraft('t1', draftOf())
    const read = readStoredMailDraft('t1')
    expect(read).toEqual(draftOf())
    expect(readStoredMailDraft('t2')).toBeNull()
  })

  it('keeps attachments and the chosen mailbox', () => {
    writeStoredMailDraft('t1', draftOf({ body: '', attachments: [attachment] }))
    const read = readStoredMailDraft('t1')
    expect(read?.attachments).toEqual([attachment])
    expect(read?.channelAccountId).toBe('chan-1')
  })

  it('an empty draft removes the stored entry', () => {
    writeStoredMailDraft('t1', draftOf())
    writeStoredMailDraft('t1', draftOf({ body: '   ', attachments: [] }))
    expect(store.has(mailDraftStorageKey('t1'))).toBe(false)
    expect(readStoredMailDraft('t1')).toBeNull()
  })

  it('clearStoredMailDraft drops the entry', () => {
    writeStoredMailDraft('t1', draftOf())
    clearStoredMailDraft('t1')
    expect(readStoredMailDraft('t1')).toBeNull()
  })

  it('ignores corrupt or foreign payloads', () => {
    store.set(mailDraftStorageKey('t1'), 'not json {')
    expect(readStoredMailDraft('t1')).toBeNull()
    store.set(mailDraftStorageKey('t1'), JSON.stringify({ body: 'x', mode: 'nope' }))
    expect(readStoredMailDraft('t1')).toBeNull()
    store.set(mailDraftStorageKey('t1'), JSON.stringify({ mode: 'reply', body: 'x' }))
    expect(readStoredMailDraft('t1')).toBeNull()
  })

  it('fills missing optional fields with defaults', () => {
    store.set(
      mailDraftStorageKey('t1'),
      JSON.stringify({ mode: 'forward', sourceMessageId: 'm1', body: 'tekst' }),
    )
    const read = readStoredMailDraft('t1')
    expect(read).toMatchObject({
      mode: 'forward',
      sourceMessageId: 'm1',
      body: 'tekst',
      to: '',
      cc: '',
      bcc: '',
      subject: '',
      attachments: [],
      channelAccountId: null,
    })
  })

  it('mailDraftHasContent: body or attachments count as content', () => {
    expect(mailDraftHasContent({ body: 'x', attachments: [] })).toBe(true)
    expect(mailDraftHasContent({ body: '', attachments: [attachment] })).toBe(true)
    expect(mailDraftHasContent({ body: '  ', attachments: [] })).toBe(false)
  })
})
