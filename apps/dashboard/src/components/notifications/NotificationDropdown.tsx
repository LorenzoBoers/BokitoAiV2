import React from 'react';
import { Bell, MessageSquare, UserCheck, AlertTriangle, AtSign } from 'lucide-react';
import { useNotifications } from '../../context/NotificationContext';
import { Button } from '../ui/button';
import { Dropdown } from '../ui/dropdown';
import { NotificationType } from '../../types/custom-db';

const NOTIFICATION_ICONS: Record<NotificationType, React.ComponentType<{ size?: number; className?: string }>> = {
  mention: AtSign,
  assignment: UserCheck,
  comment: MessageSquare,
  webhook_failure: AlertTriangle
};

function formatTimeAgo(timestamp: string): string {
  const now = new Date();
  const time = new Date(timestamp);
  const diffMs = now.getTime() - time.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return 'Nu';
  if (diffMins < 60) return `${diffMins}m geleden`;
  if (diffHours < 24) return `${diffHours}u geleden`;
  return `${diffDays}d geleden`;
}

export default function NotificationDropdown() {
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();

  const handleNotificationClick = (notification: typeof notifications[0]) => {
    if (!notification.read) {
      markAsRead(notification.id);
    }
    
    // Navigate to record if available
    if (notification.recordId && notification.tableName) {
      // In a real app, this would navigate to /database/${tableName}/record/${recordId}
      console.log(`Navigate to record ${notification.recordId} in table ${notification.tableName}`);
    }
  };

  const trigger = (
    <Button
      variant="ghost"
      size="icon"
      className="relative"
      aria-label="Meldingen"
    >
      <Bell size={16} />
      {unreadCount > 0 && (
        <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-accent rounded-full text-[8px] font-bold flex items-center justify-center text-white">
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
            Meldingen
          </h3>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={markAllAsRead}
              className="text-xs h-6 px-2"
            >
              Alles markeren
            </Button>
          )}
        </div>

        <div className="space-y-1 max-h-96 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="text-center py-6 text-text-muted text-sm">
              Geen meldingen
            </div>
          ) : (
            notifications.map((notification) => {
              const IconComponent = NOTIFICATION_ICONS[notification.type];
              
              return (
                <div
                  key={notification.id}
                  onClick={() => handleNotificationClick(notification)}
                  className={`
                    p-3 rounded-lg cursor-pointer transition-colors
                    hover:bg-bg-muted/50
                    ${!notification.read ? 'bg-accent/5 border-l-2 border-l-accent' : ''}
                  `}
                >
                  <div className="flex gap-3">
                    <div className={`
                      w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0
                      ${notification.type === 'webhook_failure' ? 'bg-red-100 text-red-600' : 'bg-accent/10 text-accent'}
                    `}>
                      <IconComponent size={14} />
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="font-medium text-sm text-text-heading leading-tight">
                          {notification.title}
                        </h4>
                        {!notification.read && (
                          <div className="w-2 h-2 bg-accent rounded-full flex-shrink-0 mt-1" />
                        )}
                      </div>
                      
                      <p className="text-xs text-text-muted mt-1 line-clamp-2">
                        {notification.message}
                      </p>
                      
                      <p className="text-xs text-text-muted mt-2">
                        {formatTimeAgo(notification.timestamp)}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {notifications.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border">
            <Button variant="ghost" size="sm" className="w-full text-xs h-8">
              Alle meldingen bekijken
            </Button>
          </div>
        )}
      </div>
    </Dropdown>
  );
}