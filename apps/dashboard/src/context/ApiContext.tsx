import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import type { ApiKey, Webhook, RateLimitInfo, ApiUsageStats, WebhookTrigger } from '../types/api';

interface ApiContextValue {
  // API Keys
  apiKeys: ApiKey[];
  createApiKey: (name: string, scope: 'read' | 'read_write') => Promise<ApiKey>;
  revokeApiKey: (keyId: string) => Promise<void>;
  
  // Webhooks
  webhooks: Webhook[];
  createWebhook: (tableId: number, url: string, triggers: WebhookTrigger, secret?: string) => Promise<Webhook>;
  updateWebhook: (webhookId: string, data: Partial<Pick<Webhook, 'url' | 'triggers' | 'secret' | 'isActive'>>) => Promise<void>;
  deleteWebhook: (webhookId: string) => Promise<void>;
  
  // Rate Limits & Usage
  rateLimits: Record<string, RateLimitInfo>; // keyed by API key ID
  usageStats: Record<string, ApiUsageStats[]>; // keyed by API key ID
  
  // Loading states
  loading: {
    apiKeys: boolean;
    webhooks: boolean;
    rateLimits: boolean;
    usageStats: boolean;
  };
  
  // Actions
  refreshApiKeys: () => Promise<void>;
  refreshWebhooks: () => Promise<void>;
  refreshRateLimits: () => Promise<void>;
  refreshUsageStats: () => Promise<void>;
}

const ApiContext = createContext<ApiContextValue | null>(null);

// Mock data for development
const mockApiKeys: ApiKey[] = [
  {
    id: '1',
    name: 'Production API',
    key: 'bkt_live_1234567890abcdef1234567890abcdef',
    maskedKey: 'bkt_live_****************************cdef',
    scope: 'read_write',
    createdAt: '2024-01-15T10:30:00Z',
    lastUsed: '2024-01-20T14:22:00Z',
    isActive: true,
  },
  {
    id: '2',
    name: 'Analytics Dashboard',
    key: 'bkt_live_abcdef1234567890abcdef1234567890',
    maskedKey: 'bkt_live_****************************7890',
    scope: 'read',
    createdAt: '2024-01-10T09:15:00Z',
    lastUsed: '2024-01-19T16:45:00Z',
    isActive: true,
  },
];

const mockWebhooks: Webhook[] = [
  {
    id: '1',
    tableId: 1,
    tableName: 'Customers',
    url: 'https://api.example.com/webhooks/customers',
    triggers: { create: true, update: true, delete: false },
    secret: 'whsec_1234567890abcdef',
    isActive: true,
    createdAt: '2024-01-12T11:20:00Z',
    lastDelivery: {
      timestamp: '2024-01-20T15:30:00Z',
      status: 200,
      response: '{"success": true, "id": "cust_123"}',
      attempt: 1,
    },
  },
];

const mockRateLimits: Record<string, RateLimitInfo> = {
  '1': {
    readLimit: 120,
    writeLimit: 60,
    currentUsage: { read: 45, write: 12 },
    resetTime: '2024-01-20T16:00:00Z',
  },
  '2': {
    readLimit: 120,
    writeLimit: 60,
    currentUsage: { read: 89, write: 0 },
    resetTime: '2024-01-20T16:00:00Z',
  },
};

const mockUsageStats: Record<string, ApiUsageStats[]> = {
  '1': Array.from({ length: 30 }, (_, i) => ({
    date: new Date(Date.now() - (29 - i) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    readRequests: Math.floor(Math.random() * 100) + 20,
    writeRequests: Math.floor(Math.random() * 50) + 5,
    errors: Math.floor(Math.random() * 5),
  })),
  '2': Array.from({ length: 30 }, (_, i) => ({
    date: new Date(Date.now() - (29 - i) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    readRequests: Math.floor(Math.random() * 80) + 10,
    writeRequests: 0,
    errors: Math.floor(Math.random() * 2),
  })),
};

export function ApiProvider({ children }: { children: React.ReactNode }) {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>(mockApiKeys);
  const [webhooks, setWebhooks] = useState<Webhook[]>(mockWebhooks);
  const [rateLimits, setRateLimits] = useState<Record<string, RateLimitInfo>>(mockRateLimits);
  const [usageStats, setUsageStats] = useState<Record<string, ApiUsageStats[]>>(mockUsageStats);
  
  const [loading, setLoading] = useState({
    apiKeys: false,
    webhooks: false,
    rateLimits: false,
    usageStats: false,
  });

  const generateApiKey = (scope: 'read' | 'read_write'): string => {
    const prefix = 'bkt_live_';
    const chars = 'abcdef0123456789';
    let key = prefix;
    for (let i = 0; i < 32; i++) {
      key += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return key;
  };

  const maskApiKey = (key: string): string => {
    if (key.length < 12) return key;
    const prefix = key.substring(0, 8);
    const suffix = key.substring(key.length - 4);
    const masked = '*'.repeat(key.length - 12);
    return prefix + masked + suffix;
  };

  const createApiKey = useCallback(async (name: string, scope: 'read' | 'read_write'): Promise<ApiKey> => {
    setLoading(prev => ({ ...prev, apiKeys: true }));
    
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const key = generateApiKey(scope);
    const newApiKey: ApiKey = {
      id: Date.now().toString(),
      name,
      key,
      maskedKey: maskApiKey(key),
      scope,
      createdAt: new Date().toISOString(),
      isActive: true,
    };
    
    setApiKeys(prev => [...prev, newApiKey]);
    setLoading(prev => ({ ...prev, apiKeys: false }));
    
    return newApiKey;
  }, []);

  const revokeApiKey = useCallback(async (keyId: string): Promise<void> => {
    setLoading(prev => ({ ...prev, apiKeys: true }));
    
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 300));
    
    setApiKeys(prev => prev.filter(key => key.id !== keyId));
    setLoading(prev => ({ ...prev, apiKeys: false }));
  }, []);

  const createWebhook = useCallback(async (
    tableId: number,
    url: string,
    triggers: WebhookTrigger,
    secret?: string
  ): Promise<Webhook> => {
    setLoading(prev => ({ ...prev, webhooks: true }));
    
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const newWebhook: Webhook = {
      id: Date.now().toString(),
      tableId,
      tableName: `Table ${tableId}`, // In real app, would lookup table name
      url,
      triggers,
      secret,
      isActive: true,
      createdAt: new Date().toISOString(),
    };
    
    setWebhooks(prev => [...prev, newWebhook]);
    setLoading(prev => ({ ...prev, webhooks: false }));
    
    return newWebhook;
  }, []);

  const updateWebhook = useCallback(async (
    webhookId: string,
    data: Partial<Pick<Webhook, 'url' | 'triggers' | 'secret' | 'isActive'>>
  ): Promise<void> => {
    setLoading(prev => ({ ...prev, webhooks: true }));
    
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 300));
    
    setWebhooks(prev => prev.map(webhook => 
      webhook.id === webhookId ? { ...webhook, ...data } : webhook
    ));
    setLoading(prev => ({ ...prev, webhooks: false }));
  }, []);

  const deleteWebhook = useCallback(async (webhookId: string): Promise<void> => {
    setLoading(prev => ({ ...prev, webhooks: true }));
    
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 300));
    
    setWebhooks(prev => prev.filter(webhook => webhook.id !== webhookId));
    setLoading(prev => ({ ...prev, webhooks: false }));
  }, []);

  const refreshApiKeys = useCallback(async (): Promise<void> => {
    setLoading(prev => ({ ...prev, apiKeys: true }));
    // In real app, would fetch from API
    await new Promise(resolve => setTimeout(resolve, 300));
    setLoading(prev => ({ ...prev, apiKeys: false }));
  }, []);

  const refreshWebhooks = useCallback(async (): Promise<void> => {
    setLoading(prev => ({ ...prev, webhooks: true }));
    // In real app, would fetch from API
    await new Promise(resolve => setTimeout(resolve, 300));
    setLoading(prev => ({ ...prev, webhooks: false }));
  }, []);

  const refreshRateLimits = useCallback(async (): Promise<void> => {
    setLoading(prev => ({ ...prev, rateLimits: true }));
    // In real app, would fetch from API
    await new Promise(resolve => setTimeout(resolve, 300));
    setLoading(prev => ({ ...prev, rateLimits: false }));
  }, []);

  const refreshUsageStats = useCallback(async (): Promise<void> => {
    setLoading(prev => ({ ...prev, usageStats: true }));
    // In real app, would fetch from API
    await new Promise(resolve => setTimeout(resolve, 300));
    setLoading(prev => ({ ...prev, usageStats: false }));
  }, []);

  const value = useMemo<ApiContextValue>(() => ({
    apiKeys,
    createApiKey,
    revokeApiKey,
    webhooks,
    createWebhook,
    updateWebhook,
    deleteWebhook,
    rateLimits,
    usageStats,
    loading,
    refreshApiKeys,
    refreshWebhooks,
    refreshRateLimits,
    refreshUsageStats,
  }), [
    apiKeys,
    createApiKey,
    revokeApiKey,
    webhooks,
    createWebhook,
    updateWebhook,
    deleteWebhook,
    rateLimits,
    usageStats,
    loading,
    refreshApiKeys,
    refreshWebhooks,
    refreshRateLimits,
    refreshUsageStats,
  ]);

  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

export function useApi() {
  const ctx = useContext(ApiContext);
  if (!ctx) throw new Error('useApi must be used inside ApiProvider');
  return ctx;
}