export interface ApiKey {
  id: string;
  name: string;
  key: string; // Full key, only shown once on creation
  maskedKey: string; // Masked version for display
  scope: 'read' | 'read_write';
  createdAt: string;
  lastUsed?: string;
  isActive: boolean;
}

export interface ApiEndpoint {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  description: string;
  requestSchema?: Record<string, any>;
  responseSchema?: Record<string, any>;
  requiresAuth: boolean;
}

export interface TableEndpoints {
  tableName: string;
  tableSlug: string;
  endpoints: ApiEndpoint[];
}

export interface WebhookTrigger {
  create: boolean;
  update: boolean;
  delete: boolean;
}

export interface Webhook {
  id: string;
  tableId: number;
  tableName: string;
  url: string;
  triggers: WebhookTrigger;
  secret?: string;
  isActive: boolean;
  createdAt: string;
  lastDelivery?: {
    timestamp: string;
    status: number;
    response: string;
    attempt: number;
  };
}

export interface WebhookDeliveryLog {
  id: string;
  webhookId: string;
  timestamp: string;
  httpStatus: number;
  responsePreview: string;
  attempt: number;
  success: boolean;
}

export interface RateLimitInfo {
  readLimit: number; // requests per minute
  writeLimit: number; // requests per minute
  currentUsage: {
    read: number;
    write: number;
  };
  resetTime: string;
}

export interface ApiUsageStats {
  date: string;
  readRequests: number;
  writeRequests: number;
  errors: number;
}

export interface OpenApiSpec {
  openapi: string;
  info: {
    title: string;
    version: string;
    description: string;
  };
  servers: Array<{
    url: string;
    description: string;
  }>;
  paths: Record<string, any>;
  components: {
    schemas: Record<string, any>;
    securitySchemes: Record<string, any>;
  };
  security: Array<Record<string, any>>;
}