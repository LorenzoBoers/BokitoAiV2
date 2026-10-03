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
  | 'assignment'
  | 'handoff'
  | 'task_due'
  | 'ops_alert';

/** 1 = now, 2 = later, 3 = digest (folded in the bell). */
export type NotificationTier = 1 | 2 | 3;

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  status: 'unread' | 'read' | 'archived';
  tier: NotificationTier;
  payload: Record<string, unknown>;
  createdAt: string;
}

interface NotificationContextValue {
  /** System notices only; conversation items live in For you. */
  notifications: AppNotification[];
  /** Unread tier 1 and 2 notices (the bell badge). */
  unreadCount: number;
  /** Open conversations in For you. */
  forYouCount: number;
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
  tier?: number;
  payload: Record<string, unknown>;
  created_at: string;
};

function normalize(raw: RawNotification): AppNotification {
  const tier = raw.tier === 1 || raw.tier === 3 ? raw.tier : 2;
  return {
    id: raw.id,
    kind: (raw.kind as NotificationKind) || 'status_update',
    title: raw.title,
    body: raw.body,
    status: (raw.status as AppNotification['status']) || 'unread',
    tier,
    payload: raw.payload && typeof raw.payload === 'object' ? raw.payload : {},
    createdAt: raw.created_at,
  };
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [forYouCount, setForYouCount] = useState(0);

  const unreadCount = notifications.filter((n) => n.status === 'unread' && n.tier < 3).length;

  const refresh = useCallback(async () => {
    if (!token) {
      setNotifications([]);
      setForYouCount(0);
      return;
    }
    try {
      const [rows, summary] = await Promise.all([
        apiGet<RawNotification[]>(appRoutes.notifications.list, token),
        apiGet<{ unread: number; for_you: number }>(appRoutes.notifications.summary, token),
      ]);
      setNotifications(Array.isArray(rows) ? rows.map(normalize).slice(0, 100) : []);
      setForYouCount(typeof summary?.for_you === 'number' ? summary.for_you : 0);
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
        forYouCount,
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
