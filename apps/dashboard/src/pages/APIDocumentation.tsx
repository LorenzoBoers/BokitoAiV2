import { useState } from 'react'
import { Code, Copy, Check, Sparkles, Database, Search } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'

export default function APIDocumentation() {
  const [copiedEndpoint, setCopiedEndpoint] = useState<string | null>(null)

  const copyToClipboard = async (text: string, endpointId: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedEndpoint(endpointId)
      setTimeout(() => setCopiedEndpoint(null), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  const endpoints = [
    {
      id: 'list-tables',
      method: 'GET',
      path: '/api/tables',
      title: 'List Tables',
      description: 'Get all tables in the workspace',
      response: {
        tables: [
          {
            id: 1,
            name: 'Customers',
            slug: 'customers',
            magic_table_enabled: true
          }
        ]
      }
    },
    {
      id: 'get-table',
      method: 'GET',
      path: '/api/tables/{id}',
      title: 'Get Table',
      description: 'Get a specific table with its configuration',
      response: {
        id: 1,
        name: 'Customers',
        slug: 'customers',
        magic_table_config: {
          enabled: true,
          indexed_fields: ['name', 'description'],
          sync_status: {
            state: 'up_to_date',
            message: 'Synchronized at 14:30'
          }
        }
      }
    },
    {
      id: 'list-records',
      method: 'GET',
      path: '/api/tables/{id}/records',
      title: 'List Records',
      description: 'Get records from a table with pagination',
      queryParams: ['page', 'limit', 'sort', 'filter'],
      response: {
        records: [
          {
            id: 1,
            data: {
              name: 'John Doe',
              email: 'john@example.com'
            }
          }
        ],
        pagination: {
          page: 1,
          limit: 50,
          total: 150
        }
      }
    },
    {
      id: 'create-record',
      method: 'POST',
      path: '/api/tables/{id}/records',
      title: 'Create Record',
      description: 'Create a new record in a table',
      body: {
        name: 'Jane Doe',
        email: 'jane@example.com'
      },
      response: {
        id: 2,
        data: {
          name: 'Jane Doe',
          email: 'jane@example.com'
        },
        created_at: '2026-04-03T10:30:00Z'
      }
    }
  ]

  const magicTableEndpoints = [
    {
      id: 'magic-search',
      method: 'POST',
      path: '/api/magic/{table}/search',
      title: 'Semantic Search',
      description: 'Perform semantic search on Magic Table indexed content',
      body: {
        query: 'customer satisfaction issues',
        limit: 10,
        min_score: 0.7
      },
      response: {
        results: [
          {
            id: 1,
            data: {
              name: 'Customer Complaint',
              description: 'Issues with product quality and service'
            },
            relevance_score: 0.95
          }
        ],
        total_results: 1,
        query_time_ms: 45
      }
    },
    {
      id: 'magic-enrich',
      method: 'POST',
      path: '/api/magic/{table}/enrich/{record_id}',
      title: 'AI Record Enrichment',
      description: 'Enrich a record with AI-generated content',
      body: {
        fields: ['description', 'category', 'sentiment']
      },
      response: {
        suggestions: [
          {
            field: 'description',
            value: 'AI-generated description based on available data',
            confidence: 0.85
          },
          {
            field: 'category',
            value: 'Business',
            confidence: 0.92
          }
        ]
      }
    },
    {
      id: 'magic-duplicates',
      method: 'POST',
      path: '/api/magic/{table}/check-duplicates',
      title: 'Duplicate Detection',
      description: 'Check for potential duplicates before creating a record',
      body: {
        name: 'John Smith',
        email: 'john.smith@example.com'
      },
      response: {
        duplicates: [
          {
            record_id: 15,
            similarity_score: 0.87,
            matching_fields: ['name', 'email']
          }
        ]
      }
    },
    {
      id: 'magic-sync',
      method: 'POST',
      path: '/api/magic/{table}/sync',
      title: 'Sync Vector Index',
      description: 'Manually trigger synchronization of the vector index',
      response: {
        status: 'syncing',
        records_to_index: 150,
        estimated_time_seconds: 30
      }
    },
    {
      id: 'magic-config',
      method: 'PUT',
      path: '/api/magic/{table}/config',
      title: 'Update Magic Table Config',
      description: 'Update Magic Table configuration for a table',
      body: {
        enabled: true,
        indexed_fields: ['name', 'description', 'content']
      },
      response: {
        success: true,
        config: {
          enabled: true,
          indexed_fields: ['name', 'description', 'content'],
          sync_status: {
            state: 'stale',
            records_not_indexed: 25
          }
        }
      }
    }
  ]

  const renderEndpoint = (endpoint: any, isMagicTable = false) => (
    <Card key={endpoint.id} className="mb-6">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {isMagicTable && <Sparkles size={18} className="text-purple-500" />}
            <CardTitle className="text-lg">{endpoint.title}</CardTitle>
            <div className="flex items-center gap-2">
              <Badge 
                variant={endpoint.method === 'GET' ? 'secondary' : 'default'}
                className={
                  endpoint.method === 'GET' ? 'bg-green-100 text-green-800' :
                  endpoint.method === 'POST' ? 'bg-blue-100 text-blue-800' :
                  endpoint.method === 'PUT' ? 'bg-orange-100 text-orange-800' :
                  'bg-gray-100 text-gray-800'
                }
              >
                {endpoint.method}
              </Badge>
              <code className="text-sm bg-bg-muted px-2 py-1 rounded">
                {endpoint.path}
              </code>
            </div>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => copyToClipboard(endpoint.path, endpoint.id)}
            className="h-8 w-8 p-0"
          >
            {copiedEndpoint === endpoint.id ? (
              <Check size={14} className="text-green-600" />
            ) : (
              <Copy size={14} />
            )}
          </Button>
        </div>
        <p className="text-sm text-text-muted">{endpoint.description}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {endpoint.queryParams && (
          <div>
            <h4 className="text-sm font-medium mb-2">Query Parameters</h4>
            <div className="flex flex-wrap gap-2">
              {endpoint.queryParams.map((param: string) => (
                <Badge key={param} variant="outline" className="text-xs">
                  {param}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {endpoint.body && (
          <div>
            <h4 className="text-sm font-medium mb-2">Request Body</h4>
            <pre className="bg-bg-muted p-3 rounded text-xs overflow-x-auto">
              <code>{JSON.stringify(endpoint.body, null, 2)}</code>
            </pre>
          </div>
        )}

        <div>
          <h4 className="text-sm font-medium mb-2">Response</h4>
          <pre className="bg-bg-muted p-3 rounded text-xs overflow-x-auto">
            <code>{JSON.stringify(endpoint.response, null, 2)}</code>
          </pre>
        </div>
      </CardContent>
    </Card>
  )

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-4">
          <Code size={24} className="text-accent" />
          <h1 className="text-2xl font-bold text-text-heading">API Documentatie</h1>
        </div>
        <p className="text-text-muted">
          Complete API referentie voor de Bokito database en Magic Table functionaliteit.
        </p>
      </div>

      {/* Standard Database Endpoints */}
      <section className="mb-12">
        <div className="flex items-center gap-2 mb-6">
          <Database size={20} className="text-accent" />
          <h2 className="text-xl font-semibold text-text-heading">Database API</h2>
        </div>
        {endpoints.map(endpoint => renderEndpoint(endpoint))}
      </section>

      {/* Magic Table Endpoints */}
      <section>
        <div className="flex items-center gap-2 mb-6">
          <Sparkles size={20} className="text-purple-500" />
          <h2 className="text-xl font-semibold text-text-heading">Magic Table API</h2>
        </div>
        <div className="mb-4 p-4 bg-purple-50 border border-purple-200 rounded-md">
          <p className="text-sm text-purple-800">
            <strong>Magic Table endpoints</strong> zijn alleen beschikbaar voor tabellen waarbij AI-indexering is ingeschakeld. 
            Deze endpoints maken gebruik van vector embeddings voor semantisch zoeken en AI-functies.
          </p>
        </div>
        {magicTableEndpoints.map(endpoint => renderEndpoint(endpoint, true))}
      </section>

      {/* Authentication Note */}
      <section className="mt-12 p-4 bg-bg-muted rounded-md">
        <h3 className="text-sm font-medium mb-2">Authenticatie</h3>
        <p className="text-sm text-text-muted">
          Alle API endpoints vereisen authenticatie via een Bearer token in de Authorization header:
        </p>
        <pre className="mt-2 bg-bg-elevated p-2 rounded text-xs">
          <code>Authorization: Bearer your-api-token</code>
        </pre>
      </section>
    </div>
  )
}