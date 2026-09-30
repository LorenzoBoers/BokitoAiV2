import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { useContact, useContactConversations, useUpsertContact } from '@/api/queries'
import { ChannelIcon } from '@/components/ChannelIcon'
import { Avatar, Badge, Drawer, Field, KeyValue, Loading } from '@/components/ui'
import { relativeTime } from '@/lib/format'

export function ContactDrawer({
  contactId,
  open,
  onOpenChange,
}: {
  contactId: string | null
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const { t, i18n } = useTranslation()
  const contact = useContact(open ? contactId : null)
  const conversations = useContactConversations(open ? contactId : null)
  const upsert = useUpsertContact()
  const [memory, setMemory] = useState<string | null>(null)

  const c = contact.data
  const memoryValue = memory ?? c?.memory ?? ''

  async function saveMemory() {
    if (!c) return
    try {
      await upsert.mutateAsync({ contact_id: c.id, memory: memoryValue })
      setMemory(null)
      toast.success(t('common.saved'))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error'))
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} title={t('contacts.title')}>
      {!c ? (
        <Loading />
      ) : (
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <Avatar name={c.name || c.email || '?'} tone="accent" className="h-10 w-10 text-sm" />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-text-heading">{c.name || c.email || c.phone}</div>
              <div className="flex items-center gap-1.5 text-xs text-text-muted">
                <span>{t(`contacts.kind.${c.kind}`, { defaultValue: c.kind })}</span>
                {c.verified && <Badge tone="success">{t('contacts.verified')}</Badge>}
              </div>
            </div>
          </div>
          <KeyValue
            rows={[
              [t('contacts.email'), c.email ?? '—'],
              [t('contacts.phone'), c.phone ?? '—'],
              [t('contacts.language'), c.language || '—'],
              [t('contacts.lastSeen'), c.last_seen_at ? relativeTime(c.last_seen_at, i18n.language) : '—'],
              ...Object.entries(c.handles).map(([k, v]) => [k, v] as [string, string]),
            ]}
          />
          <Field label={t('contacts.memory')} hint={t('contacts.memoryHint')}>
            <textarea
              className="field min-h-[96px]"
              value={memoryValue}
              onChange={(e) => setMemory(e.target.value)}
              onBlur={() => memory !== null && memory !== c.memory && void saveMemory()}
            />
          </Field>
          <div>
            <h3 className="mb-2 text-xs font-semibold text-text-heading">{t('contacts.conversations')}</h3>
            <ul className="space-y-1">
              {(conversations.data ?? []).map((conv) => (
                <li key={conv.id}>
                  <Link
                    to={`/communication/${conv.id}`}
                    onClick={() => onOpenChange(false)}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-bg-hover"
                  >
                    <ChannelIcon channel={conv.channel} className="text-text-muted" />
                    <span className="truncate">{conv.subject || t('communication.noSubject')}</span>
                    <span className="ml-auto text-2xs text-text-muted">{relativeTime(conv.last_activity_at, i18n.language)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Drawer>
  )
}
