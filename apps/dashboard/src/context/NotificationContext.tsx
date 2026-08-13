import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { appRoutes } from '../api/routes/app.routes';
import { apiGet, apiPost } from '../lib/api';
import { onGatewayEvent } from '../lib/gateway';
import { useAuth } from './AuthContext';

export type NotificationKind =
  | 'status_update'
  | 'decision_request'
  | 'proactive'
  | 'mention'
  | 'assignment';

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  status: 'unread' | 'read' | 'archived';
  payload: Record<string, unknown>;
  createdAt: string;
}

interface NotificationContextValue {
  notifications: AppNotification[];
  unreadCount: number;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  refresh: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

type RawNotification = {
  id: string;
  kind: string;
  title: string;
  body: string;
  status: string;
  payload: Record<string, unknown>;
  created_at: string;
};

function normalize(raw: RawNotification): AppNotification {
  return {
    id: raw.id,
    kind: (raw.kind as NotificationKind) || 'status_update',
    title: raw.title,
    body: raw.body,
    status: (raw.status as AppNotification['status']) || 'unread',
    payload: raw.payload && typeof raw.payload === 'object' ? raw.payload : {},
    createdAt: raw.created_at,
  };
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  const unreadCount = notifications.filter((n) => n.status === 'unread').length;

  const refresh = useCallback(async () => {
    if (!token) {
      setNotifications([]);
      return;
    }
    try {
      const rows = await apiGet<RawNotification[]>(appRoutes.notifications.list, token);
      setNotifications(Array.isArray(rows) ? rows.map(normalize).slice(0, 100) : []);
    } catch {
      // Keep the last known list; the bell is non-critical UI.
    }
  }, [token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!token) return;
    const unsub = onGatewayEvent('notifications', (event) => {
      if (event.event === 'notification') void refresh();
    });
    return unsub;
  }, [token, refresh]);

  const markAsRead = useCallback(
    (id: string) => {
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, status: 'read' } : n)));
      if (token) {
        void apiPost(appRoutes.notifications.markRead(id), {}, token).catch(() => void refresh());
      }
    },
    [token, refresh],
  );

  const markAllAsRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => (n.status === 'unread' ? { ...n, status: 'read' } : n)));
    if (token) {
      void apiPost(appRoutes.notifications.markAllRead, {}, token).catch(() => void refresh());
    }
  }, [token, refresh]);

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        markAsRead,
        markAllAsRead,
        refresh,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used inside NotificationProvider');
  return ctx;
}
