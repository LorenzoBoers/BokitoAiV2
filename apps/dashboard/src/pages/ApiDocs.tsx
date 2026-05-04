import { useState, useEffect } from 'react';
import { ArrowLeft, Key, Copy, Play, AlertCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import SwaggerUI from 'swagger-ui-react';
import 'swagger-ui-react/swagger-ui.css';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { toast } from 'sonner';

interface TryItDialogProps {
  endpoint: {
    method: string;
    path: string;
    description: string;
  };
  apiKey: string;
}

function TryItDialog({ endpoint, apiKey }: TryItDialogProps) {
  const [requestBody, setRequestBody] = useState('');
  const [response, setResponse] = useState<{
    status: number;
    data: any;
    headers: Record<string, string>;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  const workspaceId = 'your-workspace-id';
  const fullUrl = `https://api.bokito.nl/v1/${workspaceId}${endpoint.path}`;

  const getDefaultRequestBody = () => {
    if (endpoint.method === 'POST' && endpoint.path.includes('/records/')) {
      return JSON.stringify({
        data: {
          name: "John Doe",
          email: "john@example.com"
        }
      }, null, 2);
    }
    if (endpoint.method === 'PATCH') {
      return JSON.stringify({
        data: {
          name: "Jane Doe"
        }
      }, null, 2);
    }
    if (endpoint.path.includes('/search')) {
      return JSON.stringify({
        filters: [
          {
            field: "name",
            operator: "contains",
            value: "John"
          }
        ],
        sort: [
          {
            field: "created_at",
            direction: "desc"
          }
        ],
        page: 1,
        per_page: 10
      }, null, 2);
    }
    return '';
  };

  useEffect(() => {
    if ((endpoint.method === 'POST' || endpoint.method === 'PATCH') && !requestBody) {
      setRequestBody(getDefaultRequestBody());
    }
  }, [endpoint.method, endpoint.path]);

  const executeRequest = async () => {
    if (!apiKey) {
      toast.error('Voer eerst een API sleutel in');
      return;
    }

    setLoading(true);
    setResponse(null);

    try {
      // This is a mock implementation - in a real app, you'd make the actual API call
      // For demo purposes, we'll simulate different responses
      await new Promise(resolve => setTimeout(resolve, 1000));

      let mockResponse;
      if (endpoint.method === 'GET' && !endpoint.path.includes('{id}')) {
        mockResponse = {
          status: 200,
          data: {
            items: [
              {
                id: 1,
                custom_table_id: 1,
                data: { name: "John Doe", email: "john@example.com" },
                created_at: "2024-01-20T10:30:00Z",
                updated_at: "2024-01-20T10:30:00Z"
              }
            ],
            curPage: 1,
            nextPage: null,
            prevPage: null,
            itemsReceived: 1,
            itemsTotal: 1
          },
          headers: {
            'Content-Type': 'application/json',
            'X-RateLimit-Limit': '120',
            'X-RateLimit-Remaining': '119',
            'X-RateLimit-Reset': '1642680000'
          }
        };
      } else if (endpoint.method === 'POST') {
        mockResponse = {
          status: 201,
          data: {
            id: 2,
            custom_table_id: 1,
            data: JSON.parse(requestBody || '{}').data || {},
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          },
          headers: {
            'Content-Type': 'application/json',
            'Location': `${fullUrl}/2`
          }
        };
      } else if (endpoint.method === 'DELETE') {
        mockResponse = {
          status: 200,
          data: {
            success: true,
            message: "Record deleted successfully"
          },
          headers: {
            'Content-Type': 'application/json'
          }
        };
      } else {
        mockResponse = {
          status: 200,
          data: {
            id: 1,
            custom_table_id: 1,
            data: { name: "John Doe", email: "john@example.com" },
            created_at: "2024-01-20T10:30:00Z",
            updated_at: "2024-01-20T10:30:00Z"
          },
          headers: {
            'Content-Type': 'application/json'
          }
        };
      }

      setResponse(mockResponse);
      toast.success('Request succesvol uitgevoerd');
    } catch (error) {
      setResponse({
        status: 500,
        data: { error: 'Internal Server Error', message: 'Something went wrong' },
        headers: { 'Content-Type': 'application/json' }
      });
      toast.error('Request gefaald');
    } finally {
      setLoading(false);
    }
  };

  const getMethodColor = (method: string) => {
    switch (method) {
      case 'GET': return 'text-green-600 bg-green-100 dark:bg-green-900/30';
      case 'POST': return 'text-blue-600 bg-blue-100 dark:bg-blue-900/30';
      case 'PATCH': return 'text-yellow-600 bg-yellow-100 dark:bg-yellow-900/30';
      case 'DELETE': return 'text-red-600 bg-red-100 dark:bg-red-900/30';
      default: return 'text-gray-600 bg-gray-100 dark:bg-gray-900/30';
    }
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="flex items-center gap-2">
          <Play size={14} />
          Proberen
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span className={`px-2 py-1 text-xs font-medium rounded ${getMethodColor(endpoint.method)}`}>
              {endpoint.method}
            </span>
            <code className="text-sm font-mono">{endpoint.path}</code>
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6">
          <div>
            <Label className="text-sm font-medium">Request URL</Label>
            <div className="mt-1 p-3 bg-bg-subtle border border-border rounded font-mono text-sm">
              {fullUrl}
            </div>
          </div>

          {(endpoint.method === 'POST' || endpoint.method === 'PATCH') && (
            <div>
              <Label htmlFor="request-body" className="text-sm font-medium">Request Body</Label>
              <textarea
                id="request-body"
                value={requestBody}
                onChange={(e) => setRequestBody(e.target.value)}
                className="mt-1 w-full h-32 p-3 bg-bg border border-border rounded font-mono text-sm resize-none"
                placeholder="JSON request body"
              />
            </div>
          )}

          <div className="flex justify-end">
            <Button 
              onClick={executeRequest} 
              disabled={loading || !apiKey}
              className="flex items-center gap-2"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Uitvoeren...
                </>
              ) : (
                <>
                  <Play size={16} />
                  Request Uitvoeren
                </>
              )}
            </Button>
          </div>

          {response && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <h4 className="font-medium">Response</h4>
                <span className={`px-2 py-1 text-xs font-medium rounded ${
                  response.status >= 200 && response.status < 300 
                    ? 'text-green-600 bg-green-100 dark:bg-green-900/30'
                    : 'text-red-600 bg-red-100 dark:bg-red-900/30'
                }`}>
                  {response.status}
                </span>
              </div>
              
              <div>
                <Label className="text-sm font-medium">Headers</Label>
                <div className="mt-1 p-3 bg-bg-subtle border border-border rounded">
                  <pre className="text-sm font-mono">
                    {Object.entries(response.headers)
                      .map(([key, value]) => `${key}: ${value}`)
                      .join('\n')}
                  </pre>
                </div>
              </div>
              
              <div>
                <Label className="text-sm font-medium">Body</Label>
                <div className="mt-1 p-3 bg-bg-subtle border border-border rounded">
                  <pre className="text-sm font-mono whitespace-pre-wrap">
                    {JSON.stringify(response.data, null, 2)}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ApiDocs() {
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);

  // Mock OpenAPI spec - in a real app, this would be fetched from the API
  const openApiSpec = {
    openapi: '3.1.0',
    info: {
      title: 'Bokito API',
      version: '1.0.0',
      description: 'Auto-generated API documentation for your Bokito workspace',
    },
    servers: [
      {
        url: 'https://api.bokito.nl/v1/{workspace}',
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
        RateLimited: {
          description: 'Rate limit exceeded',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
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

  const copyApiKey = async () => {
    if (!apiKey) return;
    try {
      await navigator.clipboard.writeText(apiKey);
      toast.success('API sleutel gekopieerd');
    } catch {
      toast.error('Kon niet kopiëren naar klembord');
    }
  };

  return (
    <div className="min-h-screen bg-bg">
      {/* Header */}
      <div className="bg-bg-elevated border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-4">
              <Button variant="ghost" size="sm" asChild>
                <Link to="/settings/api" className="flex items-center gap-2">
                  <ArrowLeft size={16} />
                  Terug naar API Instellingen
                </Link>
              </Button>
              <div className="h-6 w-px bg-border" />
              <div>
                <h1 className="text-lg font-semibold text-text-heading">API Documentatie</h1>
                <p className="text-sm text-text-secondary">Interactieve documentatie voor de Bokito API</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* API Key Input */}
      <div className="bg-blue-50 border-b border-blue-200 dark:bg-blue-900/20 dark:border-blue-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2 text-blue-800 dark:text-blue-200">
              <Key size={20} />
              <span className="font-medium">API Authenticatie</span>
            </div>
            <div className="flex-1 max-w-md">
              <div className="relative">
                <Input
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Voer je API sleutel in om requests te testen"
                  className="pr-20"
                />
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center space-x-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="h-6 px-1"
                  >
                    {showApiKey ? '👁️' : '👁️‍🗨️'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={copyApiKey}
                    disabled={!apiKey}
                    className="h-6 px-1"
                  >
                    <Copy size={12} />
                  </Button>
                </div>
              </div>
            </div>
            {!apiKey && (
              <div className="flex items-center space-x-2 text-yellow-800 dark:text-yellow-200">
                <AlertCircle size={16} />
                <span className="text-sm">Voer een API sleutel in om "Try it" functionaliteit te gebruiken</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Swagger UI */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-bg border border-border rounded-lg overflow-hidden">
          <SwaggerUI
            spec={openApiSpec}
            docExpansion="list"
            defaultModelsExpandDepth={1}
            defaultModelExpandDepth={1}
            displayOperationId={false}
            displayRequestDuration={true}
            filter={false}
            showExtensions={false}
            showCommonExtensions={false}
            tryItOutEnabled={!!apiKey}
            requestInterceptor={(req) => {
              if (apiKey) {
                req.headers.Authorization = `Bearer ${apiKey}`;
              }
              return req;
            }}
            onComplete={(system) => {
              // Custom styling for dark mode compatibility
              const style = document.createElement('style');
              style.textContent = `
                .swagger-ui .info .title {
                  color: var(--text-heading) !important;
                }
                .swagger-ui .info .description {
                  color: var(--text-secondary) !important;
                }
                .swagger-ui .scheme-container {
                  background: var(--bg-subtle) !important;
                  border: 1px solid var(--border) !important;
                }
                .swagger-ui .opblock.opblock-get {
                  border-color: #22c55e !important;
                }
                .swagger-ui .opblock.opblock-post {
                  border-color: #3b82f6 !important;
                }
                .swagger-ui .opblock.opblock-patch {
                  border-color: #f59e0b !important;
                }
                .swagger-ui .opblock.opblock-delete {
                  border-color: #ef4444 !important;
                }
                .swagger-ui .opblock .opblock-summary {
                  color: var(--text-heading) !important;
                }
                .swagger-ui .parameter__name {
                  color: var(--text-heading) !important;
                }
                .swagger-ui .parameter__type {
                  color: var(--text-secondary) !important;
                }
                .swagger-ui .response-col_status {
                  color: var(--text-heading) !important;
                }
                .swagger-ui .response-col_description {
                  color: var(--text-secondary) !important;
                }
                .swagger-ui .model {
                  color: var(--text-secondary) !important;
                }
                .swagger-ui .model-title {
                  color: var(--text-heading) !important;
                }
                .swagger-ui textarea {
                  background: var(--bg) !important;
                  color: var(--text-primary) !important;
                  border: 1px solid var(--border) !important;
                }
                .swagger-ui input[type=text] {
                  background: var(--bg) !important;
                  color: var(--text-primary) !important;
                  border: 1px solid var(--border) !important;
                }
                .swagger-ui select {
                  background: var(--bg) !important;
                  color: var(--text-primary) !important;
                  border: 1px solid var(--border) !important;
                }
                .swagger-ui .btn {
                  background: var(--accent) !important;
                  color: white !important;
                  border: none !important;
                }
                .swagger-ui .btn.cancel {
                  background: var(--bg-subtle) !important;
                  color: var(--text-secondary) !important;
                  border: 1px solid var(--border) !important;
                }
                .swagger-ui .highlight-code {
                  background: var(--bg-subtle) !important;
                }
                .swagger-ui .microlight {
                  color: var(--text-primary) !important;
                }
              `;
              document.head.appendChild(style);
            }}
          />
        </div>
      </div>
    </div>
  );
}