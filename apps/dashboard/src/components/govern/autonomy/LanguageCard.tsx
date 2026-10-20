import type { Dispatch, SetStateAction } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Languages, Mail, MessageSquareText, UserRound } from 'lucide-react'
import { Badge } from '../../ui/badge'
import { Button } from '../../ui/button'
import { Card } from '../../ui/card'
import { EmptyState } from '../../ui/empty-state'
import { ChannelRowsSkeleton, SettingsFieldsSkeleton } from '../../ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select'
import ProviderLogo from '../../email/ProviderLogo'
import type { EmailConnection, MailboxReplyLanguage } from '../../../lib/email-api'
import type {
  AiCommunicationSettings,
  ReplyLanguage,
  ReplySendAs,
  WorkspaceLanguage,
} from '../../../lib/inbox-api'
import { cn } from '../../../lib/utils'
import { SectionHeading, SettingRow } from './SettingRow'

const REPLY_LANGUAGES: ReplyLanguage[] = ['auto', 'nl', 'en', 'de', 'fr', 'es']
const WORKSPACE_LANGUAGES: WorkspaceLanguage[] = ['nl', 'en', 'de', 'fr', 'es']

function LanguageSelect({
  id,
  value,
  languages,
  onChange,
  includeDefault,
  defaultLabel,
}: {
  id: string
  value: string
  languages: readonly string[]
  onChange: (value: string) => void
  includeDefault?: boolean
  defaultLabel?: string
}) {
  const { t } = useTranslation('nav')
  return (
    <Select value={value || 'default'} onValueChange={(v) => onChange(v === 'default' ? '' : v)}>
      <SelectTrigger id={id} className="w-56">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {includeDefault ? <SelectItem value="default">{defaultLabel}</SelectItem> : null}
        {languages.map((lang) => (
          <SelectItem key={lang} value={lang}>
            {t(`ai.communication.languageOptions.${lang}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** Reply language, working language, sender identity and per-mailbox reply language. */
export function LanguageCard({
  settings,
  setSettings,
  mailboxes,
  mailboxesLoading,
  mailboxError,
  mailboxDrafts,
  setMailboxDrafts,
  expandedMailboxId,
  setExpandedMailboxId,
}: {
  settings: AiCommunicationSettings | null
  setSettings: Dispatch<SetStateAction<AiCommunicationSettings | null>>
  mailboxes: EmailConnection[]
  mailboxesLoading: boolean
  mailboxError: string | null
  mailboxDrafts: Record<number, MailboxReplyLanguage>
  setMailboxDrafts: Dispatch<SetStateAction<Record<number, MailboxReplyLanguage>>>
  expandedMailboxId: number | null
  setExpandedMailboxId: Dispatch<SetStateAction<number | null>>
}) {
  const { t } = useTranslation('nav')
  const effectiveLabel = (language: MailboxReplyLanguage | undefined) =>
    t(`ai.communication.languageOptions.${language || settings?.replyLanguage || 'auto'}`)

  return (
    <Card className="space-y-5 p-5" data-testid="ai-handling-language">
      <SectionHeading
        title={t('ai.communication.languageTitle')}
        description={t('ai.communication.languageDescription')}
      />
      {!settings ? (
        <SettingsFieldsSkeleton rows={2} />
      ) : (
        <div className="space-y-5">
          <SettingRow
            first
            icon={Languages}
            htmlFor="ai-reply-language"
            label={t('ai.communication.replyLanguageLabel')}
            hint={t('ai.communication.replyLanguageHint')}
          >
            <LanguageSelect
              id="ai-reply-language"
              value={settings.replyLanguage}
              languages={REPLY_LANGUAGES}
              onChange={(v) =>
                setSettings((prev) => (prev ? { ...prev, replyLanguage: (v || 'auto') as ReplyLanguage } : prev))
              }
            />
          </SettingRow>
          <SettingRow
            icon={MessageSquareText}
            htmlFor="ai-workspace-language"
            label={t('ai.communication.workspaceLanguageLabel')}
            hint={t('ai.communication.workspaceLanguageHint')}
          >
            <LanguageSelect
              id="ai-workspace-language"
              value={settings.workspaceLanguage}
              languages={WORKSPACE_LANGUAGES}
              onChange={(v) =>
                setSettings((prev) => (prev ? { ...prev, workspaceLanguage: (v || 'nl') as WorkspaceLanguage } : prev))
              }
            />
          </SettingRow>
          <SettingRow
            icon={UserRound}
            htmlFor="ai-reply-send-as"
            label={t('ai.communication.sendAsLabel')}
            hint={t('ai.communication.sendAsHint')}
          >
            <Select
              value={settings.replySendAs}
              onValueChange={(v) => setSettings((prev) => (prev ? { ...prev, replySendAs: v as ReplySendAs } : prev))}
            >
              <SelectTrigger id="ai-reply-send-as" className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="user">{t('ai.communication.sendAsUser')}</SelectItem>
                <SelectItem value="agent">{t('ai.communication.sendAsAgent')}</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>
        </div>
      )}

      <div className="space-y-3 border-t border-border/60 pt-5">
        <SectionHeading
          title={t('ai.communication.mailboxExceptionsTitle')}
          description={t('ai.communication.mailboxExceptionsDescription')}
        />
        {mailboxesLoading ? (
          <ChannelRowsSkeleton rows={3} />
        ) : mailboxes.length === 0 ? (
          <EmptyState
            icon={Mail}
            title={t('ai.communication.noMailboxTitle')}
            description={t('ai.communication.noMailboxDescription')}
            action={
              <Button size="sm" variant="secondary" asChild>
                <Link to="/settings/channels">{t('ai.communication.goToMailboxes')}</Link>
              </Button>
            }
          />
        ) : (
          <div className="space-y-2">
            {mailboxError ? <p className="text-xs text-destructive">{mailboxError}</p> : null}
            {mailboxes.map((mailbox) => {
              const value = mailboxDrafts[mailbox.id] ?? ''
              const expanded = expandedMailboxId === mailbox.id
              return (
                <div key={mailbox.id} className="overflow-hidden rounded-lg border border-border/60">
                  <button
                    type="button"
                    onClick={() => setExpandedMailboxId((prev) => (prev === mailbox.id ? null : mailbox.id))}
                    className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-bg-hover/40"
                    aria-expanded={expanded}
                  >
                    <ProviderLogo provider={mailbox.provider} className="h-5 w-5 shrink-0 object-contain" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate-fade text-sm font-medium text-text-heading">
                          {mailbox.displayName || mailbox.mailboxEmail}
                        </p>
                        {value ? (
                          <Badge variant="accent" className="rounded-md px-1.5 py-0.5 text-2xs font-medium">
                            {t('ai.communication.customBadge')}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="truncate-fade text-xs text-text-muted">{mailbox.mailboxEmail}</p>
                      <p className="mt-1 text-xs text-text-secondary">{effectiveLabel(value)}</p>
                    </div>
                    <ChevronDown
                      size={16}
                      className={cn('shrink-0 text-text-muted transition-transform', expanded && 'rotate-180')}
                    />
                  </button>
                  {expanded ? (
                    <div className="flex items-start justify-between gap-4 border-t border-border/60 bg-bg-elevated/30 px-3 py-4">
                      <p className="mt-2 max-w-sm text-xs text-text-muted">{t('ai.communication.mailboxLanguageHint')}</p>
                      <LanguageSelect
                        id={`ai-language-mailbox-${mailbox.id}`}
                        value={value}
                        languages={REPLY_LANGUAGES}
                        onChange={(next) =>
                          setMailboxDrafts((prev) => ({ ...prev, [mailbox.id]: next as MailboxReplyLanguage }))
                        }
                        includeDefault
                        defaultLabel={t('ai.communication.useDefault')}
                      />
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Card>
  )
}
