import { XANO_BASE_URL, requireAccessToken } from './xano';
import type { MCPServer, MCPTestResult, MCPConnectionConfig } from '../types/mcp';

// const API_BASE = `${XANO_BASE_URL}/api:${import.meta.env.VITE_API_GROUP_APP || 'app'}`; // Reserved for future API calls

function getToken(): string {
  return requireAccessToken();
}

// Note: request function reserved for future API calls
// async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
//   const headers: Record<string, string> = {
//     Authorization: `Bearer ${getToken()}`,
//   };
//   const init: RequestInit = { method, headers };

//   if (body !== undefined) {
//     headers['Content-Type'] = 'application/json';
//     init.body = JSON.stringify(body);
//   }

//   const res = await fetch(`${API_BASE}${path}`, init);
//   if (!res.ok) {
//     const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
//     throw new Error(err.message || `HTTP ${res.status}`);
//   }
//   return res.json();
// }

// Generate MCP server URLs based on workspace
export function generateMCPServerUrls(workspaceId: string): { schema: string; data: string } {
  const baseUrl = XANO_BASE_URL.replace('/api', ''); // Remove /api from base URL
  return {
    schema: `${baseUrl}/mcp/schema/${workspaceId}`,
    data: `${baseUrl}/mcp/data/${workspaceId}`
  };
}

// Get MCP connection configuration for current user
export function getMCPConnectionConfig(): MCPConnectionConfig {
  const token = getToken();
  // In a real implementation, we'd get the workspace ID from the auth context
  // For now, we'll use a placeholder
  const workspaceId = 'workspace-123'; // This should come from auth context
  const urls = generateMCPServerUrls(workspaceId);
  
  return {
    serverUrl: urls.schema, // Default to schema server
    apiKey: token,
    workspaceId
  };
}

// Get MCP servers configuration
export function getMCPServers(): MCPServer[] {
  const config = getMCPConnectionConfig();
  const urls = generateMCPServerUrls(config.workspaceId);
  
  return [
    {
      id: 'schema-server',
      name: 'Schema MCP Server',
      type: 'schema',
      url: urls.schema,
      enabled: true,
      status: 'unknown',
      description: 'Provides tools for managing database schema: tables, fields, relations, and views'
    },
    {
      id: 'data-server', 
      name: 'Data MCP Server',
      type: 'data',
      url: urls.data,
      enabled: true,
      status: 'unknown',
      description: 'Provides tools for managing data: create, read, update, delete records'
    }
  ];
}

// Test MCP server connection
export async function testMCPServer(serverId: string): Promise<MCPTestResult> {
  try {
    const servers = getMCPServers();
    const server = servers.find(s => s.id === serverId);
    
    if (!server) {
      return {
        success: false,
        message: 'Server not found',
        error: 'Invalid server ID'
      };
    }

    // Mock test - in real implementation this would call the actual MCP endpoint
    // For now, simulate a successful test by calling list_tables tool
    const mockResponse = await mockMCPCall(server.type, 'list_tables', {});
    
    return {
      success: true,
      message: 'Connection successful',
      data: mockResponse
    };
  } catch (error) {
    return {
      success: false,
      message: 'Connection failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// Mock MCP call for testing - in real implementation this would call actual MCP endpoints
async function mockMCPCall(serverType: 'schema' | 'data', tool: string, params: unknown): Promise<unknown> {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 500));
  
  if (serverType === 'schema' && tool === 'list_tables') {
    // Mock response for list_tables
    return {
      tables: [
        { id: 1, name: 'Customers', slug: 'customers' },
        { id: 2, name: 'Orders', slug: 'orders' },
        { id: 3, name: 'Products', slug: 'products' }
      ]
    };
  }
  
  if (serverType === 'data' && tool === 'list_records') {
    // Mock response for list_records
    return {
      records: [
        { id: 1, data: { name: 'John Doe', email: 'john@example.com' } },
        { id: 2, data: { name: 'Jane Smith', email: 'jane@example.com' } }
      ],
      total: 2
    };
  }
  
  return { success: true, tool, params };
}

// Update MCP server status
export async function updateMCPServerStatus(serverId: string): Promise<MCPServer> {
  const servers = getMCPServers();
  const server = servers.find(s => s.id === serverId);
  
  if (!server) {
    throw new Error('Server not found');
  }

  const testResult = await testMCPServer(serverId);
  
  return {
    ...server,
    status: testResult.success ? 'online' : 'offline',
    lastTested: new Date().toISOString()
  };
}

// Generate Claude Desktop config
export function generateClaudeDesktopConfig(): string {
  const config = getMCPConnectionConfig();
  const servers = getMCPServers();
  
  const mcpServers: Record<string, unknown> = {};
  
  servers.forEach(server => {
    if (server.enabled) {
      mcpServers[server.id] = {
        command: "node",
        args: ["-e", `
          // MCP Server for ${server.name}
          const server = {
            name: "${server.name}",
            version: "1.0.0",
            capabilities: {
              tools: {}
            }
          };
          console.log(JSON.stringify(server));
        `],
        env: {
          MCP_SERVER_URL: server.url,
          MCP_API_KEY: config.apiKey,
          MCP_WORKSPACE_ID: config.workspaceId
        }
      };
    }
  });
  
  return JSON.stringify({
    mcpServers
  }, null, 2);
}

// Generate generic MCP client config
export function generateGenericMCPConfig(): string {
  const config = getMCPConnectionConfig();
  const servers = getMCPServers();
  
  const mcpConfig = {
    servers: servers
      .filter(server => server.enabled)
      .map(server => ({
        id: server.id,
        name: server.name,
        type: server.type,
        url: server.url,
        auth: {
          type: "bearer",
          token: config.apiKey
        },
        workspace_id: config.workspaceId
      }))
  };
  
  return JSON.stringify(mcpConfig, null, 2);
}