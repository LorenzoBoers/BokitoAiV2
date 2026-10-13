import { describe, expect, it } from 'vitest'
import {
  activityEntryPath,
  channelFolderPath,
  notificationSignalId,
  openEntityPath,
  pickClosestThreadBySubject,
  restoredEntityPath,
  runThreadPath,
} from './open-entity'

describe('restoredEntityPath', () => {
  it('maps Bin types to the live page of the restored object', () => {
    expect(restoredEntityPath('conversation', 'sig-1')).toBe('/communication/inbox/all/t/sig-1')
    expect(restoredEntityPath('project', 'p1')).toBe('/folders/p1')
    expect(restoredEntityPath('knowledge', 'd1')).toBe('/knowledge/d1')
    expect(restoredEntityPath('contact', 'c1')).toBe('/contacts/c1')
    expect(restoredEntityPath('company', 'o1')).toBe('/contacts/companies/o1')
    expect(restoredEntityPath('playbook', 'w1')).toBe('/workstreams/w1')
    expect(restoredEntityPath('trigger', 't1')).toBe('/agenda?trigger=t1')
  })

  it('opens a project canvas on its folder via the restore hint', () => {
    expect(restoredEntityPath('canvas', 'cv1', { project_id: 'p9' })).toBe('/folders/p9?tab=canvas&canvas=cv1')
    expect(restoredEntityPath('canvas', 'cv1')).toBe('/cockpit/canvas?canvas=cv1')
  })

  it('returns null for kinds without a page', () => {
    expect(restoredEntityPath('inbox_rule', 'r1')).toBeNull()
    expect(restoredEntityPath('saved_reply', 's1')).toBeNull()
  })

  it('opens a restored team on its Communication folder', () => {
    expect(restoredEntityPath('team', 'team-1')).toBe('/communication/team/team-1')
  })
})

describe('Communication folders', () => {
  it('opens a team folder, or the Team page without an id', () => {
    expect(openEntityPath({ type: 'team', id: 't1' })).toBe('/communication/team/t1')
    expect(openEntityPath({ type: 'team' })).toBe('/team')
  })

  it('opens channel folders by kind, mailboxes by connection id', () => {
    expect(openEntityPath({ type: 'channel', key: 'email', connectionId: 12 })).toBe(
      '/communication/channel/email/12',
    )
    expect(openEntityPath({ type: 'channel', key: 'webchat' })).toBe('/communication/channel/webchat')
  })

  it('maps a channel row onto its folder; mailboxes need the hub id', () => {
    expect(channelFolderPath({ channel: 'email', kind: 'email_mailbox', hubConnectionId: 7 })).toBe(
      '/communication/channel/email/7',
    )
    expect(channelFolderPath({ channel: 'email', kind: 'email_relay', hubConnectionId: null })).toBeNull()
    expect(channelFolderPath({ channel: 'widget', kind: 'widget' })).toBe('/communication/channel/webchat')
    expect(channelFolderPath({ channel: 'whatsapp', kind: 'whatsapp' })).toBe('/communication/channel/whatsapp')
    expect(channelFolderPath({ channel: 'sms', kind: 'sms' })).toBeNull()
  })
})

describe('openEntityPath', () => {
  it('opens runs on the agent page, or Activity without an agent', () => {
    expect(openEntityPath({ type: 'run', id: 'r1', agentId: 'a1' })).toBe('/agents/a1/runs/r1')
    expect(openEntityPath({ type: 'run', id: 'r1' })).toBe('/agents#activity')
  })

  it('opens a working agent where it works', () => {
    expect(openEntityPath({ type: 'agent', id: 'a1', live: { threadId: 'sig-1' } })).toBe(
      '/communication/inbox/open/t/sig-1',
    )
    expect(openEntityPath({ type: 'agent', id: 'a1', live: { activityId: 'run-2' } })).toBe('/agents/a1/runs/run-2')
    expect(openEntityPath({ type: 'agent', id: 'a1' })).toBe('/agents/a1')
  })

  it('opens triggers on Agenda', () => {
    expect(openEntityPath({ type: 'trigger', id: 't1' })).toBe('/agenda?trigger=t1')
    expect(openEntityPath({ type: 'trigger', agentId: 'a1' })).toBe('/agenda?agent=a1')
  })
})

describe('notification links', () => {
  const open = (kind: string, payload: Record<string, unknown>) =>
    openEntityPath({ type: 'notification', kind, payload })

  it('opens decision threads in For you, internal ones too', () => {
    expect(open('decision_request', { signal_id: 'sig-1', channel: 'email' })).toBe(
      '/communication/inbox/for_you/t/sig-1',
    )
    expect(open('decision_request', { signal_id: 'sig-2', channel: 'internal', folder: 'internal' })).toBe(
      '/communication/inbox/for_you/t/sig-2',
    )
  })

  it('deep-links to the decision card when the payload carries a message id', () => {
    expect(open('decision_request', { signal_id: 'sig-3', message_id: 'msg-9' })).toBe(
      '/communication/inbox/for_you/t/sig-3?message=msg-9',
    )
  })

  it('falls back to For you when a decision has no signal id', () => {
    expect(open('decision_request', { channel: 'email' })).toBe('/communication/inbox/for_you')
  })

  it('accepts numeric thread ids in older payloads', () => {
    expect(notificationSignalId({ thread_id: 42 })).toBe('42')
  })

  it('routes system notices to their surface', () => {
    expect(open('ops_alert', { account_id: 'acc-1' })).toBe('/settings/channels')
    expect(open('ops_alert', {})).toBe('/agents#activity')
    expect(open('status_update', { agent_id: 'a1' })).toBe('/agents/a1')
    expect(open('mystery', {})).toBeNull()
  })
})

describe('activityEntryPath', () => {
  it('prefers the conversation, then the run, then the audited resource', () => {
    expect(activityEntryPath({ signalId: 's1', runId: 'r1', agentId: 'a1' })).toBe('/communication/inbox/all/t/s1')
    expect(activityEntryPath({ runId: 'r1', agentId: 'a1' })).toBe('/agents/a1/runs/r1')
    expect(activityEntryPath({ resourceType: 'signal', resourceId: 's2' })).toBe('/communication/inbox/all/t/s2')
    expect(activityEntryPath({ resourceType: 'project', resourceId: 'p1' })).toBe('/folders/p1')
    expect(activityEntryPath({})).toBeNull()
  })
})

describe('pickClosestThreadBySubject', () => {
  it('picks the same-titled thread nearest the occurrence time', () => {
    const picked = pickClosestThreadBySubject(
      [
        { id: 'old', emailSubject: 'Daily platform scan', lastMessageAt: '2026-06-18T14:57:00Z' },
        { id: 'near', emailSubject: 'Daily platform scan', lastMessageAt: '2026-08-24T14:56:00Z' },
        { id: 'other', emailSubject: 'Reply to customer message', lastMessageAt: '2026-08-24T14:56:00Z' },
      ],
      'Daily platform scan',
      '2026-08-24T14:56:00Z',
    )
    expect(picked?.id).toBe('near')
  })

  it('returns null when there is nothing to match', () => {
    expect(pickClosestThreadBySubject([], 'Daily platform scan', '2026-08-24T14:56:00Z')).toBeNull()
    expect(
      pickClosestThreadBySubject(
        [{ id: 'other', emailSubject: 'Daily platform scan', lastMessageAt: '2026-08-24T14:56:00Z' }],
        'Lead: platformbacklog bekijken',
        '2026-08-24T14:56:00Z',
      ),
    ).toBeNull()
  })

  it('matches check-in labels and Dutch titles to their threads', () => {
    expect(
      pickClosestThreadBySubject(
        [{ id: 'beat', emailSubject: 'Heartbeat', lastMessageAt: '2026-08-24T14:56:00Z' }],
        'Check-in',
        '2026-08-24T14:56:00Z',
      )?.id,
    ).toBe('beat')
    expect(
      pickClosestThreadBySubject(
        [
          { id: 'scan', emailSubject: 'Daily platform scan', lastMessageAt: '2026-08-24T14:56:00Z' },
          { id: 'lead', emailSubject: 'PO wake: review platform backlog', lastMessageAt: '2026-08-24T12:53:00Z' },
        ],
        'Lead: platformbacklog bekijken',
        '2026-08-24T12:53:00Z',
      )?.id,
    ).toBe('lead')
  })
})

describe('runThreadPath', () => {
  it('opens the matching conversation, else the run page', () => {
    const threads = [
      { id: 'near', emailSubject: 'Daily platform scan', lastMessageAt: '2026-08-24T14:56:00Z' },
      { id: 'old', emailSubject: 'Daily platform scan', lastMessageAt: '2026-06-18T14:57:00Z' },
    ]
    expect(
      runThreadPath(
        { id: 'r', agent_id: 'a', task_subject: 'Daily platform scan', started_at: '2026-08-24T14:56:00Z' },
        threads,
      ),
    ).toBe('/communication/inbox/all/t/near')
    expect(runThreadPath({ id: 'r', agent_id: 'a', task_subject: 'Something else' }, threads)).toBe(
      '/agents/a/runs/r',
    )
  })
})
