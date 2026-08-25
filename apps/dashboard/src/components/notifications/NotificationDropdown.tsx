import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, AtSign, Bell, CalendarClock, MessageSquare, ShieldCheck, UserCheck } from 'lucide-react';
import { useNotifications, type AppNotification, type NotificationKind } from '../../context/NotificationContext';
import { Button } from '../ui/button';
import { Dropdown } from '../ui/dropdown';
import { agentRunsPath, inboxPath } from '../../lib/messages-paths';

const NOTIFICATION_ICONS: Record<NotificationKind, React.ComponentType<{ size?: number; className?: string }>> = {
  status_update: CalendarClock,
  decision_request: ShieldCheck,
  proactive: MessageSquare,
  mention: AtSign,
  assignment: UserCheck,
  ops_alert: AlertTriangle,
};

function formatTimeAgo(timestamp: string, t: (key: string, opts?: { count: number }) => string): string {
  const now = new Date();
  const time = new Date(timestamp);
  const diffMs = now.getTime() - time.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return t('notificationsUi.now');
  if (diffMins < 60) return t('notificationsUi.minutesAgo', { count: diffMins });
  if (diffHours < 24) return t('notificationsUi.hoursAgo', { count: diffHours });
  return t('notificationsUi.daysAgo', { count: diffDays });
}

function isInternalPayload(payload: Record<string, unknown>): boolean {
  const channel = typeof payload.channel === 'string' ? payload.channel : '';
  const folder = typeof payload.folder === 'string' ? payload.folder : '';
  return folder === 'internal' || channel === 'internal' || channel === 'assistant';
}

/** Route a notification to the surface that owns it. */
function notificationTarget(notification: AppNotification): string | null {
  const payload = notification.payload;
  const signalId = typeof payload.signal_id === 'string' ? payload.signal_id : null;
  if (signalId) {
    if (isInternalPayload(payload)) {
      return notification.kind === 'decision_request'
        ? agentRunsPath('awaiting-decision', signalId)
        : agentRunsPath('all', signalId);
    }
    return inboxPath('all', signalId);
  }
  if (typeof payload.platform_change_id === 'string') return '/settings/govern?tab=drafts';
  if (typeof payload.trigger_id === 'string') return '/agenda';
  if (notification.kind === 'ops_alert') {
    // Channel problems are fixed in settings; run failures live under Agent runs.
    if (typeof payload.account_id === 'string') return '/settings/channels';
    return agentRunsPath('all');
  }
  if (notification.kind === 'decision_request') {
    return isInternalPayload(payload)
      ? agentRunsPath('awaiting-decision')
      : inboxPath('all');
  }
  if (notification.kind === 'status_update') {
    return isInternalPayload(payload) ? agentRunsPath('all') : inboxPath('all');
  }
  return null;
}

export default function NotificationDropdown() {
  const { t } = useTranslation('nav');
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();
  const navigate = useNavigate();

  const handleNotificationClick = (notification: AppNotification) => {
    if (notification.status === 'unread') {
      markAsRead(notification.id);
    }
    const target = notificationTarget(notification);
    if (target) navigate(target);
  };

  const trigger = (
    <Button
      variant="ghost"
      size="icon"
      className="relative"
      aria-label={t('notificationsUi.aria')}
    >
      <Bell size={16} />
      {unreadCount > 0 && (
        <span className="count-pop absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-accent rounded-full text-[8px] font-bold flex items-center justify-center text-accent-fg">
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      )}
    </Button>
  );

  return (
    <Dropdown trigger={trigger} align="right">
      <div className="p-3">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm text-text-heading">
            {t('notificationsUi.title')}
          </h3>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={markAllAsRead}
              className="text-xs h-6 px-2"
            >
              {t('notificationsUi.markAll')}
            </Button>
          )}
        </div>

        <div className="space-y-1 max-h-96 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-sm text-text-muted">{t('notificationsUi.empty')}</p>
              <button
                type="button"
                onClick={() => navigate(inboxPath('all'))}
                className="mt-2 text-xs font-medium text-accent hover:underline"
              >
                {t('notificationsUi.openCommunication')}
              </button>
            </div>
          ) : (
            notifications.map((notification) => {
              const IconComponent = NOTIFICATION_ICONS[notification.kind] ?? MessageSquare;
              const unread = notification.status === 'unread';

              return (
                <div
                  key={notification.id}
                  onClick={() => handleNotificationClick(notification)}
                  data-active={unread || undefined}
                  className={`
                    row-interactive p-3 rounded-lg cursor-pointer
                    hover:bg-bg-muted/50
                    ${unread ? 'bg-accent/5' : ''}
                  `}
                >
                  <div className="flex gap-3">
                    <div className={`
                      w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0
                      ${unread ? 'bg-accent/10 text-accent' : 'bg-bg-muted text-text-muted'}
                    `}>
                      <IconComponent size={14} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm ${unread ? 'font-medium text-text-heading' : 'text-text-primary'}`}>
                        {notification.title}
                      </p>
                      <p className="text-xs text-text-secondary mt-0.5 line-clamp-2">
                        {notification.body}
                      </p>
                      <p className="text-xs text-text-muted mt-1">
                        {formatTimeAgo(notification.createdAt, t)}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </Dropdown>
  );
}
