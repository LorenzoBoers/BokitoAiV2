import { useState } from 'react';
import { Copy, ChevronDown, ChevronRight, Code, ExternalLink } from 'lucide-react';
import { useDatabase } from '../../context/DatabaseContext';
import { Button } from '../ui/button';
import { toast } from 'sonner';
import type { ApiEndpoint, TableEndpoints } from '../../types/api';
import type { CustomTable, CustomField } from '../../types/custom-db';
import { PUBLIC_API_URL } from '../../lib/api.config';

interface EndpointCardProps {
  endpoint: ApiEndpoint;
  tableName: string;
  workspaceId: string;
}

function EndpointCard({ endpoint, tableName, workspaceId }: EndpointCardProps) {
  const [expanded, setExpanded] = useState(false);
  
  const fullUrl = `${PUBLIC_API_URL}/${workspaceId}/records/${tableName}${endpoint.path === '/{id}' ? '/123' : endpoint.path === '/search' ? '/search' : ''}`;
  
  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(fullUrl);
      toast.success('URL gekopieerd');
    } catch {
      toast.error('Kon URL niet kopiëren');
    }
  };

  const getMethodColor = (method: string) => {
    switch (method) {
      case 'GET': return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
      case 'POST': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300';
      case 'PATCH': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300';
      case 'DELETE': return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300';
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300';
    }
  };

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center justify-between bg-bg-subtle hover:bg-bg-hover transition-colors text-left"
      >
        <div className="flex items-center space-x-3">
          <span className={`px-2 py-1 text-xs font-medium rounded ${getMethodColor(endpoint.method)}`}>
            {endpoint.method}
          </span>
          <code className="text-sm font-mono text-text-heading">{endpoint.path}</code>
          <span className="text-sm text-text-secondary">{endpoint.description}</span>
        </div>
        <div className="flex items-center space-x-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              copyUrl();
            }}
            className="h-8 px-2"
          >
            <Copy size={14} />
          </Button>
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </div>
      </button>
      
      {expanded && (
        <div className="p-4 border-t border-border space-y-4">
          <div>
            <h4 className="text-sm font-medium text-text-heading mb-2">URL</h4>
            <div className="bg-bg border border-border rounded p-3">
              <code className="text-sm font-mono break-all">{fullUrl}</code>
            </div>
          </div>

          <div>
            <h4 className="text-sm font-medium text-text-heading mb-2">Headers</h4>
            <div className="bg-bg border border-border rounded p-3 space-y-2">
              <div className="flex justify-between">
                <code className="text-sm font-mono">Authorization</code>
                <code className="text-sm font-mono text-text-secondary">Bearer your_api_key</code>
              </div>
              <div className="flex justify-between">
                <code className="text-sm font-mono">Content-Type</code>
                <code className="text-sm font-mono text-text-secondary">application/json</code>
              </div>
            </div>
          </div>

          {endpoint.method === 'GET' && (
            <div>
              <h4 className="text-sm font-medium text-text-heading mb-2">Query Parameters</h4>
              <div className="bg-bg border border-border rounded p-3 space-y-2">
                {endpoint.path === '' && (
                  <>
                    <div className="flex justify-between">
                      <code className="text-sm font-mono">page</code>
                      <span className="text-sm text-text-secondary">Paginanummer (standaard: 1)</span>
                    </div>
                    <div className="flex justify-between">
                      <code className="text-sm font-mono">per_page</code>
                      <span className="text-sm text-text-secondary">Items per pagina (standaard: 50, max: 100)</span>
                    </div>
                  </>
                )}
                <div className="flex justify-between">
                  <code className="text-sm font-mono">fields</code>
                  <span className="text-sm text-text-secondary">Komma-gescheiden lijst van velden (bijv: id,name,email)</span>
                </div>
              </div>
            </div>
          )}

          {(endpoint.method === 'POST' || endpoint.method === 'PATCH') && (
            <div>
              <h4 className="text-sm font-medium text-text-heading mb-2">Request Body</h4>
              <div className="bg-bg border border-border rounded p-3">
                <pre className="text-sm font-mono text-text-secondary">
{endpoint.path === '/search' ? `{
  "filters": [
    {
      "field": "name",
      "operator": "contains",
      "value": "John"
    }
  ],
  "sort": [
    {
      "field": "created_at",
      "direction": "desc"
    }
  ],
  "page": 1,
  "per_page": 50
}` : `{
  "data": {
    "name": "John Doe",
    "email": "john@example.com"
  }
}`}
                </pre>
              </div>
            </div>
          )}

          <div>
            <h4 className="text-sm font-medium text-text-heading mb-2">Response</h4>
            <div className="bg-bg border border-border rounded p-3">
              <pre className="text-sm font-mono text-text-secondary">
{endpoint.method === 'DELETE' ? `{
  "success": true,
  "message": "Record deleted successfully"
}` : endpoint.path === '' || endpoint.path === '/search' ? `{
  "items": [...],
  "curPage": 1,
  "nextPage": 2,
  "prevPage": null,
  "itemsReceived": 50,
  "itemsTotal": 150
}` : `{
  "id": 123,
  "custom_table_id": 1,
  "data": {
    "name": "John Doe",
    "email": "john@example.com"
  },
  "created_at": "2024-01-20T10:30:00Z",
  "updated_at": "2024-01-20T10:30:00Z"
}`}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface TableEndpointsCardProps {
  table: CustomTable;
  fields: CustomField[];
  workspaceId: string;
}

function TableEndpointsCard({ table, fields, workspaceId }: TableEndpointsCardProps) {
  const [expanded, setExpanded] = useState(false);

  const endpoints: ApiEndpoint[] = [
    {
      method: 'GET',
      path: '',
      description: 'Lijst van records ophalen',
      requiresAuth: true,
    },
    {
      method: 'POST',
      path: '',
      description: 'Nieuw record aanmaken',
      requiresAuth: true,
    },
    {
      method: 'GET',
      path: '/{id}',
      description: 'Record ophalen op ID',
      requiresAuth: true,
    },
    {
      method: 'PATCH',
      path: '/{id}',
      description: 'Record bijwerken',
      requiresAuth: true,
    },
    {
      method: 'DELETE',
      path: '/{id}',
      description: 'Record verwijderen (soft delete)',
      requiresAuth: true,
    },
    {
      method: 'POST',
      path: '/search',
      description: 'Records zoeken met filters',
      requiresAuth: true,
    },
  ];

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center justify-between bg-bg-subtle hover:bg-bg-hover transition-colors text-left"
      >
        <div className="flex items-center space-x-3">
          <div 
            className="w-3 h-3 rounded-full flex-shrink-0"
            style={{ backgroundColor: table.color }}
          />
          <span className="font-medium text-text-heading">{table.name}</span>
          <span className="text-sm text-text-secondary">({endpoints.length} endpoints)</span>
        </div>
        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </button>
      
      {expanded && (
        <div className="border-t border-border">
          <div className="p-4 bg-bg-subtle border-b border-border">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-medium text-text-heading">Base URL</h4>
                <code className="text-sm font-mono text-text-secondary">
                  /api/v1/{workspaceId}/records/{table.slug}
                </code>
              </div>
              <div className="text-right">
                <div className="text-sm text-text-secondary">Velden: {fields.length}</div>
                <div className="text-xs text-text-muted">
                  {fields.map(f => f.name).join(', ')}
                </div>
              </div>
            </div>
          </div>
          
          <div className="p-4 space-y-3">
            {endpoints.map((endpoint, index) => (
              <EndpointCard
                key={index}
                endpoint={endpoint}
                tableName={table.slug}
                workspaceId={workspaceId}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function EndpointDocumentation() {
  const { tables, fields } = useDatabase();
  const workspaceId = 'your-workspace-id'; // In real app, get from auth context

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-text-heading">API Endpoints</h2>
          <p className="text-sm text-text-secondary">
            Automatisch gegenereerde endpoints voor elke tabel
          </p>
        </div>
        <Button variant="outline" asChild>
          <a href="/docs" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2">
            <ExternalLink size={16} />
            Interactieve Docs
          </a>
        </Button>
      </div>

      {tables.length === 0 ? (
        <div className="text-center py-12">
          <div className="w-12 h-12 mx-auto mb-4 bg-bg-subtle rounded-lg flex items-center justify-center">
            <Code size={24} className="text-text-muted" />
          </div>
          <h3 className="text-lg font-medium text-text-heading mb-2">Geen tabellen</h3>
          <p className="text-text-secondary mb-4">
            Maak eerst tabellen aan om API endpoints te genereren
          </p>
          <Button variant="outline" asChild>
            <a href="/database">Naar Database</a>
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {tables.map((table) => (
            <TableEndpointsCard
              key={table.id}
              table={table}
              fields={fields.filter(f => f.custom_table_id === table.id)}
              workspaceId={workspaceId}
            />
          ))}
        </div>
      )}

      <div className="bg-bg-subtle border border-border rounded-lg p-4">
        <h3 className="text-sm font-medium text-text-heading mb-2">Algemene Informatie</h3>
        <div className="space-y-2 text-sm text-text-secondary">
          <div>
            <strong>Base URL:</strong> <code>{`${PUBLIC_API_URL}/{workspaceId}`}</code>
          </div>
          <div>
            <strong>Authenticatie:</strong> Bearer token in Authorization header
          </div>
          <div>
            <strong>Rate Limits:</strong> 120 requests/min voor lezen, 60 requests/min voor schrijven
          </div>
          <div>
            <strong>Paginering:</strong> Gebruik <code>page</code> en <code>per_page</code> parameters
          </div>
          <div>
            <strong>Veld selectie:</strong> Gebruik <code>fields</code> parameter (bijv: <code>?fields=id,name,email</code>)
          </div>
        </div>
      </div>
    </div>
  );
}