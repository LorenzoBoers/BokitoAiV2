import assert from 'node:assert/strict'
import { channelKind, channelLabel, isCustomerChannel } from './channel'
import { copyKeys, translate } from './copy'
import { resolveComposerSurface } from './composer'
import { coerceInboxView, inboxFolderParam, tomorrowMorningIso, viewsForFolder } from './inbox-views'
import { pathFromNotificationData, resolveNotificationRoute } from './notification-path'
import {
  agentRoleLabel,
  categoryLabel,
  displayContactAddress,
  displayThreadTitle,
  eventLabel,
  firstName,
  greeting,
  humanizeContactName,
  isPlaceholderContactAddress,
  optionLabel,
  optionResolveAction,
  relativeTime,
  roleLabel,
  translateKnownText,
  translateMockAgentBody,
  urgencyLabel,
  urgencyTier,
  userNumericId,
} from './format'

assert.equal(channelKind('customer_widget'), 'widget')
assert.equal(channelKind('webchat'), 'widget')
assert.equal(channelLabel('email', 'nl'), 'E-mail')
assert.equal(channelLabel('widget', 'nl'), 'Websitechat')
assert.equal(channelLabel('widget', 'en'), 'Website chat')
assert.equal(eventLabel('decision_approved', 'en'), 'Decision approved')
assert.equal(eventLabel('unknown_thing', 'en'), 'Unknown thing')
assert.equal(firstName('Lorenzo Test', 'a@b.c'), 'Lorenzo')
assert.equal(greeting('en', 9), 'Good morning')
assert.equal(greeting('nl', 20), 'Goedenavond')
assert.equal(optionResolveAction({ id: 'reject' }), 'rejected')
assert.equal(optionResolveAction({ id: 'send' }), 'approved')
assert.equal(relativeTime(new Date().toISOString(), 'en'), 'now')
assert.equal(isCustomerChannel('whatsapp'), true)
assert.equal(isCustomerChannel('assistant'), false)
assert.equal(translate('en', 'home.autonomy', { pct: 42 }), '42% handled automatically')
assert.equal(pathFromNotificationData({ kind: 'decision_request' }), '/(tabs)/decisions')
assert.equal(pathFromNotificationData({ signal_id: 'abc' }), '/thread/abc')

assert.equal(isPlaceholderContactAddress('visitor@web'), true)
assert.equal(isPlaceholderContactAddress('cust_ed5ab564'), true)
assert.equal(isPlaceholderContactAddress('jane@acme.com'), false)
assert.equal(humanizeContactName('Website visitor', 'visitor@web', 'Websitebezoeker'), 'Websitebezoeker')
assert.equal(humanizeContactName('Jane Doe', 'jane@acme.com', 'Websitebezoeker'), 'Jane Doe')
assert.equal(displayContactAddress('visitor@web'), null)
assert.equal(displayContactAddress('jane@acme.com'), 'jane@acme.com')
assert.equal(translateKnownText('Reply to customer message', 'nl'), 'Antwoord op klantbericht')
assert.equal(translateKnownText('Assist: Daily platform scan', 'nl'), 'Hulp: Dagelijkse platformscan')
assert.equal(translateKnownText('Suggested reply', 'nl'), 'Voorgesteld antwoord')
assert.equal(roleLabel('owner', 'nl'), 'Eigenaar')
assert.equal(roleLabel('admin', 'en'), 'Admin')
assert.equal(categoryLabel('billing', 'nl'), 'Facturatie')
assert.equal(
  displayThreadTitle(
    { channel: 'widget', folder: 'external', contact_name: 'Website visitor', contact_email: 'visitor@web' },
    'nl',
    { visitor: 'Websitebezoeker', noSubject: 'Geen onderwerp', unknownSender: 'Onbekende afzender' },
  ),
  'Websitebezoeker',
)
assert.equal(
  displayThreadTitle(
    { channel: 'assistant', folder: 'internal', email_subject: 'Daily platform scan' },
    'nl',
    { visitor: 'Websitebezoeker', noSubject: 'Geen onderwerp', unknownSender: 'Onbekende afzender' },
  ),
  'Dagelijkse platformscan',
)

const hourAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
assert.equal(relativeTime(hourAgo, 'nl'), '2u')
assert.equal(relativeTime(hourAgo, 'en'), '2h')

assert.equal(translate('en', 'agent.using', { name: 'search_index' }), 'Running search_index')
assert.equal(translate('nl', 'agent.thinkingActive'), 'Aan het nadenken...')
assert.equal(translate('nl', 'tabs.decisions'), 'Beslissingen')
assert.equal(translate('nl', 'home.loopGovern'), 'Beslissingen')
assert.equal(categoryLabel('support', 'nl'), 'Ondersteuning')
assert.equal(agentRoleLabel('orchestrator', 'nl'), 'Lead')
assert.equal(optionLabel({ id: 'send', label: 'Send reply' }, 'nl'), 'Antwoord versturen')
assert.equal(urgencyLabel('medium', 'nl'), 'Gemiddeld')
assert.equal(urgencyTier(90), 'urgent')
assert.equal(urgencyTier(55), 'high')
assert.equal(urgencyTier(10), 'low')
assert.equal(urgencyLabel(82, 'en'), 'Urgent')
assert.equal(urgencyLabel(82, 'nl'), 'Urgent')
assert.equal(userNumericId('01234567-89ab-cdef-0123-456789abcdef'), Number.parseInt('01234567', 16))
assert.ok(viewsForFolder('external').includes('pinned'))
assert.match(
  translateMockAgentBody(
    '[mock] I received your message about: pricing. This is the Bokito AI OS assistant running in mock mode.',
    'nl',
  ),
  /pricing/,
)
assert.equal(resolveNotificationRoute({ platform_change_id: 'chg-1' }).type, 'web')
assert.equal(resolveNotificationRoute({ agent_id: 'ag-1' }).path, '/agents/ag-1')
assert.equal(pathFromNotificationData({ platform_change_id: 'chg-1' }), '/(tabs)/home')
assert.equal(resolveComposerSurface({ channel: 'email', contact_email: 'a@b.c', contact_name: 'Ann' }, { visitor: 'Visitor', agent: 'AI' }).replyLabelKey, 'thread.replyEmail')
assert.equal(resolveComposerSurface({ channel: 'assistant', folder: 'internal' }, { visitor: 'Visitor', agent: 'AI' }).showCloseActions, false)
assert.equal(resolveComposerSurface({ channel: 'widget', contact_name: 'Ann' }, { visitor: 'Visitor', agent: 'AI' }).replyLabelKey, 'thread.replyChat')
assert.equal(resolveComposerSurface({ channel: 'whatsapp', contact_name: 'Ann' }, { visitor: 'Visitor', agent: 'AI' }).replyLabelKey, 'thread.replyWhatsapp')
assert.equal(resolveComposerSurface({ channel: 'slack', contact_name: '#ops' }, { visitor: 'Visitor', agent: 'AI' }).replyLabelKey, 'thread.replySlack')
assert.equal(resolveComposerSurface({ channel: 'internal' }, { visitor: 'Visitor', agent: 'AI' }).showCloseActions, false)

assert.equal(resolveNotificationRoute({ contact_id: 'c-1' }).type, 'web')
assert.equal(resolveNotificationRoute({ contact_id: 'c-1' }).path, '/contacts/c-1')
assert.equal(resolveNotificationRoute({ trigger_id: 'tr-1' }).path, '/agenda')
assert.equal(resolveNotificationRoute({ agent_id: 'ag-1' }).type, 'web')
assert.equal(resolveNotificationRoute({ signal_id: 'sig-1', agent_id: 'ag-1' }).type, 'app')
assert.equal(resolveNotificationRoute({ kind: 'ops_alert', account_id: 'acc-1' }).path, '/settings/channels')

assert.ok(viewsForFolder('external').includes('snoozed'))
assert.ok(!viewsForFolder('external').includes('updates'))
assert.ok(viewsForFolder('internal').includes('results'))
assert.ok(!viewsForFolder('internal').includes('spam'))
assert.equal(coerceInboxView('internal', 'spam'), 'all_open')
assert.equal(inboxFolderParam('awaiting_decision', 'external'), undefined)
assert.equal(inboxFolderParam('all_open', 'external'), 'external')
const snoozeFrom = new Date('2026-08-26T15:00:00')
const snoozeUntil = new Date(tomorrowMorningIso(snoozeFrom))
assert.equal(snoozeUntil.getHours(), 9)
assert.ok(snoozeUntil.getTime() > snoozeFrom.getTime())

assert.equal(channelLabel('internal', 'en'), 'Team')
assert.equal(channelLabel('internal', 'nl'), 'Team')
assert.equal(translate('en', 'agent.consultingKnowledge'), 'Consulting knowledge')
assert.equal(translate('nl', 'agent.consultingKnowledge'), 'Kennis raadplegen')
assert.equal(translate('en', 'inbox.updates'), 'Updates')
assert.equal(translate('nl', 'inbox.snoozed'), 'Uitgesteld')

const missingNl = copyKeys('en').filter((key) => !copyKeys('nl').includes(key))
assert.deepEqual(missingNl, [])

console.log('mobile format/channel checks passed')
