import React, { createContext, useContext, useState, useCallback } from 'react';
import { Notification, NotificationType } from '../types/custom-db';
import { isBokitoMode } from '../lib/bokito-mode';

interface NotificationContextValue {
  notifications: Notification[];
  unreadCount: number;
  addNotification: (type: NotificationType, title: string, message: string, recordId?: number, tableName?: string) => void;
  markAsRead: (id: number) => void;
  markAllAsRead: () => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

// Mock notifications data
const mockNotifications: Notification[] = [
  {
    id: 1,
    type: 'mention',
    title: 'Je bent genoemd in een opmerking',
    message: 'Sarah heeft je genoemd in de "Klanten" tabel',
    timestamp: new Date(Date.now() - 1000 * 60 * 15).toISOString(), // 15 min ago
    read: false,
    recordId: 123,
    tableName: 'klanten',
    userId: 1
  },
  {
    id: 2,
    type: 'assignment',
    title: 'Record toegewezen',
    message: 'Een nieuw lead is aan jou toegewezen',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(), // 2 hours ago
    read: false,
    recordId: 456,
    tableName: 'leads',
    userId: 1
  },
  {
    id: 3,
    type: 'comment',
    title: 'Nieuwe opmerking',
    message: 'Mark heeft een opmerking geplaatst op jouw project',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(), // 4 hours ago
    read: true,
    recordId: 789,
    tableName: 'projecten',
    userId: 1
  },
  {
    id: 4,
    type: 'webhook_failure',
    title: 'Webhook fout',
    message: 'Webhook naar Slack is mislukt (3 pogingen)',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 8).toISOString(), // 8 hours ago
    read: false,
    userId: 1
  }
];

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>(
    isBokitoMode() ? [] : mockNotifications,
  );

  const unreadCount = notifications.filter(n => !n.read).length;

  const addNotification = useCallback((
    type: NotificationType, 
    title: string, 
    message: string, 
    recordId?: number, 
    tableName?: string
  ) => {
    const newNotification: Notification = {
      id: Date.now(),
      type,
      title,
      message,
      timestamp: new Date().toISOString(),
      read: false,
      recordId,
      tableName,
      userId: 1 // Would be current user ID
    };

    setNotifications(prev => [newNotification, ...prev]);
  }, []);

  const markAsRead = useCallback((id: number) => {
    setNotifications(prev => 
      prev.map(n => n.id === id ? { ...n, read: true } : n)
    );
  }, []);

  const markAllAsRead = useCallback(() => {
    setNotifications(prev => 
      prev.map(n => ({ ...n, read: true }))
    );
  }, []);

  return (
    <NotificationContext.Provider value={{
      notifications,
      unreadCount,
      addNotification,
      markAsRead,
      markAllAsRead
    }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used inside NotificationProvider');
  return ctx;
}