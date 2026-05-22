import { useState } from 'react';
import { Copy, Plus, Trash2, Eye, EyeOff, Download } from 'lucide-react';
import { useApi } from '../context/ApiContext';
import { useDatabase } from '../context/DatabaseContext';
import { DatabaseProvider } from '../context/DatabaseContext';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { toast } from 'sonner';
import ApiKeyManagement from '../components/api/ApiKeyManagement';
import EndpointDocumentation from '../components/api/EndpointDocumentation';
import WebhookConfiguration from '../components/api/WebhookConfiguration';
import RateLimitDisplay from '../components/api/RateLimitDisplay';
import UsageChart from '../components/api/UsageChart';
import { PUBLIC_API_URL } from '../lib/api.config';

function ApiSettingsContent() {
  const { apiKeys, rateLimits, usageStats } = useApi();
  const [activeTab, setActiveTab] = useState<'keys' | 'endpoints' | 'webhooks' | 'usage'>('keys');

  const generateOpenApiSpec = () => {
    // This would generate the actual OpenAPI spec based on tables and fields
    const spec = {
      openapi: '3.1.0',
      info: {
        title: 'Bokito API',
        version: '1.0.0',
        description: 'Auto-generated API documentation for your Bokito workspace',
      },
      servers: [
        {
          url: `${PUBLIC_API_URL}/{workspace}`,
          description: 'Production server',
          variables: {
            workspace: {
              default: 'your-workspace-id',
              description: 'Your workspace identifier',
            },
          },
        },
      ],
      paths: {
        '/records/{tableName}': {
          get: {
            summary: 'List records',
            description: 'Retrieve a paginated list of records from a table',
            parameters: [
              {
                name: 'tableName',
                in: 'path',
                required: true,
                schema: { type: 'string' },
                description: 'Name of the table',
              },
              {
                name: 'page',
                in: 'query',
                schema: { type: 'integer', default: 1 },
                description: 'Page number',
              },
              {
                name: 'per_page',
                in: 'query',
                schema: { type: 'integer', default: 50, maximum: 100 },
                description: 'Number of records per page',
              },
              {
                name: 'fields',
                in: 'query',
                schema: { type: 'string' },
                description: 'Comma-separated list of fields to include',
                example: 'id,name,email',
              },
            ],
            responses: {
              '200': {
                description: 'Successful response',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        items: {
                          type: 'array',
                          items: { $ref: '#/components/schemas/Record' },
                        },
                        curPage: { type: 'integer' },
                        nextPage: { type: 'integer', nullable: true },
                        prevPage: { type: 'integer', nullable: true },
                        itemsReceived: { type: 'integer' },
                        itemsTotal: { type: 'integer' },
                      },
                    },
                  },
                },
              },
              '401': { $ref: '#/components/responses/Unauthorized' },
              '429': { $ref: '#/components/responses/RateLimited' },
            },
            security: [{ ApiKeyAuth: [] }],
          },
          post: {
            summary: 'Create record',
            description: 'Create a new record in the table',
            parameters: [
              {
                name: 'tableName',
                in: 'path',
                required: true,
                schema: { type: 'string' },
              },
            ],
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'object',
                        description: 'Record data matching table schema',
                      },
                    },
                    required: ['data'],
                  },
                },
              },
            },
            responses: {
              '201': {
                description: 'Record created successfully',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Record' },
                  },
                },
              },
              '400': { $ref: '#/components/responses/BadRequest' },
              '401': { $ref: '#/components/responses/Unauthorized' },
              '429': { $ref: '#/components/responses/RateLimited' },
            },
            security: [{ ApiKeyAuth: [] }],
          },
        },
        '/records/{tableName}/{recordId}': {
          get: {
            summary: 'Get record by ID',
            parameters: [
              { name: 'tableName', in: 'path', required: true, schema: { type: 'string' } },
              { name: 'recordId', in: 'path', required: true, schema: { type: 'integer' } },
            ],
            responses: {
              '200': {
                description: 'Record found',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Record' },
                  },
                },
              },
              '404': { $ref: '#/components/responses/NotFound' },
            },
            security: [{ ApiKeyAuth: [] }],
          },
          patch: {
            summary: 'Update record',
            parameters: [
              { name: 'tableName', in: 'path', required: true, schema: { type: 'string' } },
              { name: 'recordId', in: 'path', required: true, schema: { type: 'integer' } },
            ],
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { type: 'object' },
                    },
                    required: ['data'],
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'Record updated',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Record' },
                  },
                },
              },
            },
            security: [{ ApiKeyAuth: [] }],
          },
          delete: {
            summary: 'Soft delete record',
            parameters: [
              { name: 'tableName', in: 'path', required: true, schema: { type: 'string' } },
              { name: 'recordId', in: 'path', required: true, schema: { type: 'integer' } },
            ],
            responses: {
              '200': {
                description: 'Record deleted',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        success: { type: 'boolean' },
                        message: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
            security: [{ ApiKeyAuth: [] }],
          },
        },
        '/records/{tableName}/search': {
          post: {
            summary: 'Search records',
            description: 'Search records using filters and sorting',
            parameters: [
              { name: 'tableName', in: 'path', required: true, schema: { type: 'string' } },
            ],
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      filters: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            field: { type: 'string' },
                            operator: {
                              type: 'string',
                              enum: ['eq', 'neq', 'contains', 'gt', 'lt', 'gte', 'lte', 'empty', 'not_empty'],
                            },
                            value: {},
                          },
                        },
                      },
                      sort: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            field: { type: 'string' },
                            direction: { type: 'string', enum: ['asc', 'desc'] },
                          },
                        },
                      },
                      page: { type: 'integer', default: 1 },
                      per_page: { type: 'integer', default: 50 },
                    },
                  },
                },
              },
            },
            responses: {
              '200': {
                description: 'Search results',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        items: {
                          type: 'array',
                          items: { $ref: '#/components/schemas/Record' },
                        },
                        curPage: { type: 'integer' },
                        nextPage: { type: 'integer', nullable: true },
                        prevPage: { type: 'integer', nullable: true },
                        itemsReceived: { type: 'integer' },
                        itemsTotal: { type: 'integer' },
                      },
                    },
                  },
                },
              },
            },
            security: [{ ApiKeyAuth: [] }],
          },
        },
      },
      components: {
        schemas: {
          Record: {
            type: 'object',
            properties: {
              id: { type: 'integer' },
              custom_table_id: { type: 'integer' },
              data: {
                type: 'object',
                description: 'Record data based on table schema',
              },
              created_at: { type: 'string', format: 'date-time' },
              updated_at: { type: 'string', format: 'date-time' },
            },
          },
          Error: {
            type: 'object',
            properties: {
              error: { type: 'string' },
              message: { type: 'string' },
              code: { type: 'string' },
            },
          },
        },
        responses: {
          BadRequest: {
            description: 'Bad request',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
              },
            },
          },
          Unauthorized: {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
              },
            },
          },
          NotFound: {
            description: 'Resource not found',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
              },
            },
          },
          RateLimited: {
            description: 'Rate limit exceeded',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
              },
            },
            headers: {
              'X-RateLimit-Limit': {
                description: 'Request limit per minute',
                schema: { type: 'integer' },
              },
              'X-RateLimit-Remaining': {
                description: 'Remaining requests in current window',
                schema: { type: 'integer' },
              },
              'X-RateLimit-Reset': {
                description: 'Time when rate limit resets (Unix timestamp)',
                schema: { type: 'integer' },
              },
            },
          },
        },
        securitySchemes: {
          ApiKeyAuth: {
            type: 'apiKey',
            in: 'header',
            name: 'Authorization',
            description: 'API key authentication. Use "Bearer your_api_key"',
          },
        },
      },
      security: [{ ApiKeyAuth: [] }],
    };

    const blob = new Blob([JSON.stringify(spec, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bokito-openapi.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    toast.success('OpenAPI specification downloaded');
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex-shrink-0 pb-4 border-b border-border">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-text-heading">API & Webhooks</h1>
            <p className="text-sm text-text-secondary mt-1">
              Beheer API-sleutels, bekijk endpoints en configureer webhooks
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={generateOpenApiSpec}
              className="flex items-center gap-2"
            >
              <Download size={16} />
              OpenAPI Spec
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-shrink-0 pt-4">
        <div className="flex space-x-1 bg-bg-subtle rounded-lg p-1">
          <button
            onClick={() => setActiveTab('keys')}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              activeTab === 'keys'
                ? 'bg-bg text-text-heading shadow-sm'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            API Sleutels
          </button>
          <button
            onClick={() => setActiveTab('endpoints')}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              activeTab === 'endpoints'
                ? 'bg-bg text-text-heading shadow-sm'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            Endpoints
          </button>
          <button
            onClick={() => setActiveTab('webhooks')}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              activeTab === 'webhooks'
                ? 'bg-bg text-text-heading shadow-sm'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            Webhooks
          </button>
          <button
            onClick={() => setActiveTab('usage')}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              activeTab === 'usage'
                ? 'bg-bg text-text-heading shadow-sm'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            Gebruik & Limieten
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 pt-6">
        {activeTab === 'keys' && <ApiKeyManagement />}
        {activeTab === 'endpoints' && <EndpointDocumentation />}
        {activeTab === 'webhooks' && <WebhookConfiguration />}
        {activeTab === 'usage' && (
          <div className="space-y-6">
            <RateLimitDisplay />
            <UsageChart />
          </div>
        )}
      </div>
    </div>
  );
}

export default function ApiSettings() {
  return (
    <DatabaseProvider>
      <ApiSettingsContent />
    </DatabaseProvider>
  );
}