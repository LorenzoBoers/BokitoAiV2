import React, { createContext, useContext, useCallback, useEffect, useMemo } from 'react';
import { appRoutes } from '../api/routes/app.routes';
import { apiGet, apiPost } from '../lib/api';
import type { GatewayEvent } from '../lib/gateway';
import { applyLive, listLive, seedLive, useLiveList } from '../lib/live-store';
import { useAuth } from './AuthContext';

const TABLE = 'notification';

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
  user_id?: string | null;
  signal_id?: string | null;
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

/** Same order as the list endpoint: unread first, then tier, then newest. */
function byBellOrder(a: AppNotification, b: AppNotification): number {
  const unread = Number(b.status === 'unread') - Number(a.status === 'unread');
  if (unread) return unread;
  if (a.tier !== b.tier) return a.tier - b.tier;
  return b.createdAt.localeCompare(a.createdAt);
}

/**
 * `notification` events carry the full bell row; fed by the shell live bus.
 * Rows for another person and conversation items (For you) are skipped.
 */
export function ingestNotification(event: GatewayEvent, userId: string | null | undefined) {
  if (event.event !== 'notification') return;
  const raw = event.data?.row as RawNotification | undefined;
  if (!raw?.id || raw.signal_id) return;
  if (raw.user_id && raw.user_id !== userId) return;
  applyLive<AppNotification>(TABLE, raw.id, normalize(raw));
}

function patchStatus(ids: string[] | 'all', status: AppNotification['status']) {
  for (const row of listLive<AppNotification>(TABLE)) {
    if (ids === 'all' ? row.status === 'unread' : ids.includes(row.id)) {
      applyLive<AppNotification>(TABLE, row.id, { ...row, status });
    }
  }
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  const rows = useLiveList<AppNotification>(TABLE);
  const notifications = useMemo(() => [...rows].sort(byBellOrder).slice(0, 100), [rows]);

  const unreadCount = notifications.filter((n) => n.status === 'unread' && n.tier < 3).length;

  const refresh = useCallback(async () => {
    if (!token) {
      seedLive<AppNotification>(TABLE, [], (n) => n.id);
      return;
    }
    try {
      const list = await apiGet<RawNotification[]>(appRoutes.notifications.list, token);
      seedLive(TABLE, Array.isArray(list) ? list.map(normalize) : [], (n) => n.id);
    } catch {
      // Keep the last known list; the bell is non-critical UI.
    }
  }, [token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const markAsRead = useCallback(
    (id: string) => {
      patchStatus([id], 'read');
      if (token) {
        void apiPost(appRoutes.notifications.markRead(id), {}, token).catch(() => void refresh());
      }
    },
    [token, refresh],
  );

  const markAllAsRead = useCallback(() => {
    patchStatus('all', 'read');
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
