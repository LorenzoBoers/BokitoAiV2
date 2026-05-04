export interface MCPServer {
  id: string;
  name: string;
  type: 'schema' | 'data';
  url: string;
  enabled: boolean;
  status: 'online' | 'offline' | 'unknown';
  lastTested?: string;
  description: string;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  category: 'schema' | 'data';
}

export interface MCPConnectionConfig {
  serverUrl: string;
  apiKey: string;
  workspaceId: string;
}

export interface MCPTestResult {
  success: boolean;
  message: string;
  data?: unknown;
  error?: string;
}

// Schema MCP tools
export const SCHEMA_MCP_TOOLS: MCPTool[] = [
  {
    name: 'list_tables',
    description: 'List all tables in the workspace',
    inputSchema: {},
    category: 'schema'
  },
  {
    name: 'get_table_schema',
    description: 'Get the schema/structure of a specific table',
    inputSchema: {
      type: 'object',
      properties: {
        tableId: { type: 'number', description: 'ID of the table' }
      },
      required: ['tableId']
    },
    category: 'schema'
  },
  {
    name: 'create_table',
    description: 'Create a new table',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Table name' },
        description: { type: 'string', description: 'Table description' },
        icon: { type: 'string', description: 'Table icon' },
        color: { type: 'string', description: 'Table color' }
      },
      required: ['name']
    },
    category: 'schema'
  },
  {
    name: 'add_field',
    description: 'Add a new field to a table',
    inputSchema: {
      type: 'object',
      properties: {
        tableId: { type: 'number', description: 'ID of the table' },
        name: { type: 'string', description: 'Field name' },
        fieldType: { type: 'string', description: 'Field type' },
        config: { type: 'object', description: 'Field configuration' },
        required: { type: 'boolean', description: 'Whether field is required' }
      },
      required: ['tableId', 'name', 'fieldType']
    },
    category: 'schema'
  },
  {
    name: 'update_field',
    description: 'Update an existing field',
    inputSchema: {
      type: 'object',
      properties: {
        fieldId: { type: 'number', description: 'ID of the field' },
        name: { type: 'string', description: 'Field name' },
        config: { type: 'object', description: 'Field configuration' },
        required: { type: 'boolean', description: 'Whether field is required' }
      },
      required: ['fieldId']
    },
    category: 'schema'
  },
  {
    name: 'delete_field',
    description: 'Delete a field from a table',
    inputSchema: {
      type: 'object',
      properties: {
        fieldId: { type: 'number', description: 'ID of the field to delete' }
      },
      required: ['fieldId']
    },
    category: 'schema'
  },
  {
    name: 'create_relation',
    description: 'Create a relation between tables',
    inputSchema: {
      type: 'object',
      properties: {
        sourceTableId: { type: 'number', description: 'Source table ID' },
        targetTableId: { type: 'number', description: 'Target table ID' },
        fieldName: { type: 'string', description: 'Name of the relation field' }
      },
      required: ['sourceTableId', 'targetTableId', 'fieldName']
    },
    category: 'schema'
  },
  {
    name: 'list_views',
    description: 'List all views for a table',
    inputSchema: {
      type: 'object',
      properties: {
        tableId: { type: 'number', description: 'ID of the table' }
      },
      required: ['tableId']
    },
    category: 'schema'
  }
];

// Data MCP tools
export const DATA_MCP_TOOLS: MCPTool[] = [
  {
    name: 'list_records',
    description: 'List records from a table with pagination',
    inputSchema: {
      type: 'object',
      properties: {
        tableId: { type: 'number', description: 'ID of the table' },
        page: { type: 'number', description: 'Page number (default: 1)' },
        perPage: { type: 'number', description: 'Records per page (default: 50)' }
      },
      required: ['tableId']
    },
    category: 'data'
  },
  {
    name: 'get_record',
    description: 'Get a specific record by ID',
    inputSchema: {
      type: 'object',
      properties: {
        recordId: { type: 'number', description: 'ID of the record' }
      },
      required: ['recordId']
    },
    category: 'data'
  },
  {
    name: 'create_record',
    description: 'Create a new record in a table',
    inputSchema: {
      type: 'object',
      properties: {
        tableId: { type: 'number', description: 'ID of the table' },
        data: { type: 'object', description: 'Record data as key-value pairs' }
      },
      required: ['tableId', 'data']
    },
    category: 'data'
  },
  {
    name: 'update_record',
    description: 'Update an existing record',
    inputSchema: {
      type: 'object',
      properties: {
        recordId: { type: 'number', description: 'ID of the record' },
        data: { type: 'object', description: 'Updated record data' }
      },
      required: ['recordId', 'data']
    },
    category: 'data'
  },
  {
    name: 'delete_record',
    description: 'Delete a record from a table',
    inputSchema: {
      type: 'object',
      properties: {
        recordId: { type: 'number', description: 'ID of the record to delete' }
      },
      required: ['recordId']
    },
    category: 'data'
  },
  {
    name: 'search_records',
    description: 'Search records in a table with filters',
    inputSchema: {
      type: 'object',
      properties: {
        tableId: { type: 'number', description: 'ID of the table' },
        query: { type: 'string', description: 'Search query' },
        filters: { type: 'object', description: 'Additional filters' },
        page: { type: 'number', description: 'Page number (default: 1)' },
        perPage: { type: 'number', description: 'Records per page (default: 50)' }
      },
      required: ['tableId']
    },
    category: 'data'
  },
  {
    name: 'bulk_create',
    description: 'Create multiple records at once',
    inputSchema: {
      type: 'object',
      properties: {
        tableId: { type: 'number', description: 'ID of the table' },
        records: { 
          type: 'array', 
          description: 'Array of record data objects',
          items: { type: 'object' }
        }
      },
      required: ['tableId', 'records']
    },
    category: 'data'
  }
];

export const ALL_MCP_TOOLS = [...SCHEMA_MCP_TOOLS, ...DATA_MCP_TOOLS];