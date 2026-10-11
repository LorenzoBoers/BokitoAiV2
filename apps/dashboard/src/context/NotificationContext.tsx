import React, { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { appRoutes } from '../api/routes/app.routes';
import { apiGet, apiPost } from '../lib/api';
import type { GatewayEvent } from '../lib/gateway';
import { applyLive, listLive, onLiveReconnect, seedLive, useLiveList } from '../lib/live-store';
import { openEntityPath } from '../lib/open-entity';
import { playIncomingNotificationSound } from '../lib/notification-sound';
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

/** Kinds that should chime (and toast when they are conversation work). */
const AUDIBLE_KINDS = new Set([
  'new_message',
  'mention',
  'assignment',
  'handoff',
  'decision_request',
]);

function viewingSignal(signalId: string | null | undefined): boolean {
  if (!signalId) return false;
  try {
    return window.location.pathname.includes(`/t/${encodeURIComponent(signalId)}`)
      || window.location.pathname.includes(`/t/${signalId}`);
  } catch {
    return false;
  }
}

/**
 * Sound + toast for live notices. Conversation rows stay out of the bell
 * (For you), but still announce so the operator hears the new mail.
 */
export function announceNotification(
  event: GatewayEvent,
  userId: string | null | undefined,
  navigate?: (path: string) => void,
) {
  if (event.event !== 'notification') return;
  const raw = event.data?.row as RawNotification | undefined;
  if (!raw?.id) return;
  if (raw.user_id && userId && raw.user_id !== userId) return;

  const kind = raw.kind || '';
  const signalId =
    (typeof raw.signal_id === 'string' && raw.signal_id) ||
    (typeof raw.payload?.signal_id === 'string' ? raw.payload.signal_id : null);
  const tier = raw.tier === 1 || raw.tier === 3 ? raw.tier : 2;
  const audible = AUDIBLE_KINDS.has(kind) || (!signalId && tier === 1);
  if (!audible) return;
  if (viewingSignal(signalId)) return;

  void playIncomingNotificationSound();

  // Conversation work stays out of the bell — toast + deep link instead.
  if (!signalId) return;

  const href = openEntityPath({
    type: 'notification',
    kind,
    payload: {
      ...(raw.payload && typeof raw.payload === 'object' ? raw.payload : {}),
      signal_id: signalId,
    },
  });
  const openLabel = (document.documentElement.lang || 'nl').toLowerCase().startsWith('nl')
    ? 'Openen'
    : 'Open';
  toast(raw.title || kind, {
    description: (raw.body || '').slice(0, 160) || undefined,
    duration: 6000,
    action: href
      ? {
          label: openLabel,
          onClick: () => {
            if (navigate) navigate(href);
            else window.location.assign(href);
          },
        }
      : undefined,
  });
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
  const [badgeUnread, setBadgeUnread] = useState<number | null>(null);
  const badgeRef = useRef<number | null>(null);
  const seenUnreadRef = useRef<Set<string>>(new Set());

  const unreadIds = useMemo(
    () => notifications.filter((n) => n.status === 'unread' && n.tier < 3).map((n) => n.id),
    [notifications],
  );
  const unreadCount = badgeUnread ?? unreadIds.length;

  const rememberUnread = (items: AppNotification[]) => {
    seenUnreadRef.current = new Set(
      items.filter((n) => n.status === 'unread' && n.tier < 3).map((n) => n.id),
    );
  };

  const refresh = useCallback(async () => {
    if (!token) {
      seedLive<AppNotification>(TABLE, [], (n) => n.id);
      badgeRef.current = null;
      setBadgeUnread(null);
      seenUnreadRef.current = new Set();
      return;
    }
    try {
      const params = new URLSearchParams({ limit: '100' });
      const [list, summary] = await Promise.all([
        apiGet<RawNotification[]>(appRoutes.notifications.list(params), token),
        apiGet<{ unread?: number }>(appRoutes.notifications.summary, token).catch(() => null),
      ]);
      const seeded = Array.isArray(list) ? list.map(normalize) : [];
      rememberUnread(seeded);
      seedLive(TABLE, seeded, (n) => n.id);
      if (summary && typeof summary.unread === 'number') {
        badgeRef.current = summary.unread;
        setBadgeUnread(summary.unread);
      } else {
        badgeRef.current = null;
        setBadgeUnread(null);
      }
    } catch {
      // Keep the last known list; the bell is non-critical UI.
    }
  }, [token]);

  useEffect(() => {
    if (badgeRef.current == null) {
      seenUnreadRef.current = new Set(unreadIds);
      return;
    }
    let added = 0;
    for (const id of unreadIds) {
      if (!seenUnreadRef.current.has(id)) added += 1;
    }
    seenUnreadRef.current = new Set(unreadIds);
    if (added > 0) {
      const next = badgeRef.current + added;
      badgeRef.current = next;
      setBadgeUnread(next);
    }
  }, [unreadIds]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Events published while the socket was down never reach ingestNotification.
  useEffect(() => {
    if (!token) return;
    return onLiveReconnect(() => {
      void refresh();
    });
  }, [token, refresh]);

  const markAsRead = useCallback(
    (id: string) => {
      const previous = listLive<AppNotification>(TABLE).find((row) => row.id === id) ?? null;
      const wasBadge = previous?.status === 'unread' && previous.tier < 3;
      patchStatus([id], 'read');
      if (wasBadge && badgeRef.current != null) {
        const next = Math.max(0, badgeRef.current - 1);
        badgeRef.current = next;
        setBadgeUnread(next);
      }
      if (!token) return;
      void apiPost(appRoutes.notifications.markRead(id), {}, token).catch(() => {
        if (previous && wasBadge) seenUnreadRef.current.add(previous.id);
        if (previous) applyLive(TABLE, previous.id, previous);
        if (wasBadge && badgeRef.current != null) {
          const next = badgeRef.current + 1;
          badgeRef.current = next;
          setBadgeUnread(next);
        }
        void refresh();
      });
    },
    [token, refresh],
  );

  const markAllAsRead = useCallback(() => {
    const snapshot = listLive<AppNotification>(TABLE)
      .filter((row) => row.status === 'unread')
      .map((row) => ({ ...row }));
    const previousBadge = badgeRef.current;
    patchStatus('all', 'read');
    if (previousBadge != null) {
      badgeRef.current = 0;
      setBadgeUnread(0);
    }
    if (!token) return;
    void apiPost(appRoutes.notifications.markAllRead, {}, token).catch(() => {
      seenUnreadRef.current = new Set(
        snapshot.filter((row) => row.status === 'unread' && row.tier < 3).map((row) => row.id),
      );
      for (const row of snapshot) applyLive(TABLE, row.id, row);
      if (previousBadge != null) {
        badgeRef.current = previousBadge;
        setBadgeUnread(previousBadge);
      }
      void refresh();
    });
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
