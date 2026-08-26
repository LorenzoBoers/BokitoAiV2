import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, AtSign, Bell, CalendarClock, MessageSquare, ShieldCheck, UserCheck } from 'lucide-react';
import { useNotifications, type AppNotification, type NotificationKind } from '../../context/NotificationContext';
import { Button } from '../ui/button';
import { Dropdown } from '../ui/dropdown';
import { translateDecisionText } from '../../lib/activity-labels';
import { collapseNotifications } from '../../lib/notification-groups';
import { pathForNotification } from '../../lib/notification-path';
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
  if (diffDays >= 7) return t('notificationsUi.staleDays', { count: diffDays });
  return t('notificationsUi.daysAgo', { count: diffDays });
}

export default function NotificationDropdown() {
  const { t } = useTranslation(['nav', 'communication']);
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();
  const navigate = useNavigate();
  const hasDecisions = notifications.some((item) => item.kind === 'decision_request');

  const groupedNotifications = collapseNotifications(notifications);

  const handleNotificationClick = (notification: AppNotification, ids: string[]) => {
    for (const id of ids) {
      const row = notifications.find((item) => item.id === id);
      if (row?.status === 'unread') markAsRead(id);
    }
    const target = pathForNotification({ kind: notification.kind, payload: notification.payload });
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
          <div className="flex items-center gap-1">
            {unreadCount > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={markAllAsRead}
                className="text-xs h-6 px-2"
              >
                {t('notificationsUi.markAll')}
              </Button>
            ) : null}
            {hasDecisions ? (
              <button
                type="button"
                onClick={() => navigate(agentRunsPath('awaiting-decision'))}
                className="text-xs font-medium text-accent hover:underline"
              >
                {t('notificationsUi.openDecisions')}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => navigate('/settings/notifications')}
              className="text-xs font-medium text-accent hover:underline"
            >
              {t('notificationsUi.settings')}
            </button>
          </div>
        </div>

        <div className="space-y-1 max-h-96 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-sm text-text-muted">{t('notificationsUi.empty')}</p>
              <p className="mt-1 text-[11px] text-text-muted">{t('notificationsUi.emptyHint')}</p>
              <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
                <button
                  type="button"
                  onClick={() => navigate(inboxPath('open'))}
                  className="text-xs font-medium text-accent hover:underline"
                >
                  {t('notificationsUi.openCommunication')}
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/settings/channels')}
                  className="text-xs font-medium text-accent hover:underline"
                >
                  {t('notificationsUi.openChannels')}
                </button>
              </div>
            </div>
          ) : (
            groupedNotifications.map((notification) => {
              const IconComponent = NOTIFICATION_ICONS[notification.kind] ?? MessageSquare;
              const unread = notification.status === 'unread' || notification.ids.some((id) =>
                notifications.find((item) => item.id === id)?.status === 'unread',
              );

              return (
                <div
                  key={notification.id}
                  onClick={() => handleNotificationClick(notification, notification.ids)}
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
                        {translateDecisionText(notification.title, t)}
                      </p>
                      <p className="text-xs text-text-secondary mt-0.5 line-clamp-2">
                        {translateDecisionText(notification.body, t)}
                      </p>
                      <p className="text-xs text-text-muted mt-1">
                        {formatTimeAgo(notification.createdAt, t)}
                        {notification.count > 1
                          ? ` · ${t('notificationsUi.similarCount', { count: notification.count })}`
                          : ''}
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
