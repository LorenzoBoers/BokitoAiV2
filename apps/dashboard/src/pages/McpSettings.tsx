import { useState, useEffect } from 'react';
import { Copy, Check, RefreshCw, Globe, Database, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { 
  getMCPServers, 
  updateMCPServerStatus,
  generateClaudeDesktopConfig,
  generateGenericMCPConfig,
  getMCPConnectionConfig
} from '../lib/mcp-api';
import { SCHEMA_MCP_TOOLS, DATA_MCP_TOOLS } from '../types/mcp';
import type { MCPServer, MCPTool } from '../types/mcp';

interface CopyButtonProps {
  text: string;
  label?: string;
}

function CopyButton({ text, label = 'Kopiëren' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={handleCopy}
      className="gap-1.5"
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {copied ? 'Gekopieerd!' : label}
    </Button>
  );
}

interface ServerStatusProps {
  server: MCPServer;
  onTest: (serverId: string) => void;
  testing: boolean;
}

function ServerStatus({ server, onTest, testing }: ServerStatusProps) {
  const statusColor = {
    online: 'success',
    offline: 'error',
    unknown: 'neutral'
  } as const;

  const statusText = {
    online: 'Online',
    offline: 'Offline', 
    unknown: 'Onbekend'
  } as const;

  return (
    <div className="flex items-center justify-between p-4 border border-border rounded-lg">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-bg-elevated rounded-md">
          {server.type === 'schema' ? (
            <Database size={20} className="text-text-secondary" />
          ) : (
            <Globe size={20} className="text-text-secondary" />
          )}
        </div>
        <div>
          <h3 className="font-medium text-text-primary">{server.name}</h3>
          <p className="text-sm text-text-secondary">{server.description}</p>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant={statusColor[server.status]}>
              {statusText[server.status]}
            </Badge>
            {server.lastTested && (
              <span className="text-xs text-text-muted">
                Laatst getest: {new Date(server.lastTested).toLocaleString('nl-NL')}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onTest(server.id)}
          disabled={testing}
          className="gap-1.5"
        >
          <RefreshCw size={14} className={testing ? 'animate-spin' : ''} />
          {testing ? 'Testen...' : 'Test nu'}
        </Button>
        <CopyButton text={server.url} label="URL kopiëren" />
      </div>
    </div>
  );
}

interface ToolRowProps {
  tool: MCPTool;
}

function ToolRow({ tool }: ToolRowProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <TableRow className="cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <TableCell className="font-mono text-xs">
          <div className="flex items-center gap-2">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {tool.name}
          </div>
        </TableCell>
        <TableCell>
          <Badge variant={tool.category === 'schema' ? 'info' : 'accent'}>
            {tool.category === 'schema' ? 'Schema' : 'Data'}
          </Badge>
        </TableCell>
        <TableCell className="max-w-md">
          <p className="text-sm text-text-secondary truncate">{tool.description}</p>
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow>
          <TableCell colSpan={3} className="bg-bg-elevated">
            <div className="py-2">
              <h4 className="text-sm font-medium text-text-primary mb-2">Input Schema:</h4>
              <pre className="text-xs bg-bg-surface p-3 rounded border border-border overflow-x-auto">
                {JSON.stringify(tool.inputSchema, null, 2)}
              </pre>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

export default function McpSettings() {
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [testing, setTesting] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('servers');

  useEffect(() => {
    setServers(getMCPServers());
  }, []);

  const handleTestServer = async (serverId: string) => {
    setTesting(serverId);
    try {
      const updatedServer = await updateMCPServerStatus(serverId);
      setServers(prev => prev.map(s => s.id === serverId ? updatedServer : s));
    } catch (error) {
      console.error('Failed to test server:', error);
    } finally {
      setTesting(null);
    }
  };

  const config = getMCPConnectionConfig();
  const claudeConfig = generateClaudeDesktopConfig();
  const genericConfig = generateGenericMCPConfig();

  return (
    <div className="p-6 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-text-heading mb-2">
          MCP (Model Context Protocol)
        </h1>
        <p className="text-text-secondary">
          Configureer MCP servers om je database toegankelijk te maken voor AI-modellen zoals Claude.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="servers">MCP Servers</TabsTrigger>
          <TabsTrigger value="guide">Verbindingshandleiding</TabsTrigger>
          <TabsTrigger value="tools">Beschikbare Tools</TabsTrigger>
        </TabsList>

        <TabsContent value="servers" className="space-y-6">
          <div>
            <h2 className="text-lg font-medium text-text-heading mb-4">Server Status</h2>
            <div className="space-y-4">
              {servers.map(server => (
                <ServerStatus
                  key={server.id}
                  server={server}
                  onTest={handleTestServer}
                  testing={testing === server.id}
                />
              ))}
            </div>
          </div>

          <div className="border-t border-border pt-6">
            <h2 className="text-lg font-medium text-text-heading mb-4">Authenticatie</h2>
            <div className="bg-bg-elevated p-4 rounded-lg border border-border">
              <h3 className="font-medium text-text-primary mb-2">API Key Authenticatie</h3>
              <p className="text-sm text-text-secondary mb-3">
                MCP servers gebruiken Bearer token authenticatie. Voeg je API key toe aan de Authorization header:
              </p>
              <div className="bg-bg-surface p-3 rounded border border-border font-mono text-xs">
                <div className="text-text-muted">Authorization: Bearer {config.apiKey.substring(0, 20)}...</div>
              </div>
              
              <div className="mt-4">
                <h4 className="font-medium text-text-primary mb-2">Scope Informatie</h4>
                <ul className="text-sm text-text-secondary space-y-1">
                  <li>• <strong>Read-only key:</strong> Kan alleen read tools aanroepen (list_tables, get_record, etc.)</li>
                  <li>• <strong>Read+Write key:</strong> Kan alle tools aanroepen inclusief create, update, delete</li>
                </ul>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="guide" className="space-y-6">
          <div>
            <h2 className="text-lg font-medium text-text-heading mb-4">Claude Desktop Configuratie</h2>
            <p className="text-text-secondary mb-4">
              Voeg deze configuratie toe aan je <code className="bg-bg-surface px-1 py-0.5 rounded text-xs">claude_desktop_config.json</code> bestand:
            </p>
            <div className="relative">
              <pre className="bg-bg-surface p-4 rounded border border-border text-xs overflow-x-auto">
                {claudeConfig}
              </pre>
              <div className="absolute top-3 right-3">
                <CopyButton text={claudeConfig} />
              </div>
            </div>
          </div>

          <div>
            <h2 className="text-lg font-medium text-text-heading mb-4">Generieke MCP Client Configuratie</h2>
            <p className="text-text-secondary mb-4">
              Voor andere MCP clients, gebruik deze JSON configuratie:
            </p>
            <div className="relative">
              <pre className="bg-bg-surface p-4 rounded border border-border text-xs overflow-x-auto">
                {genericConfig}
              </pre>
              <div className="absolute top-3 right-3">
                <CopyButton text={genericConfig} />
              </div>
            </div>
          </div>

          <div className="bg-bg-elevated p-4 rounded-lg border border-border">
            <h3 className="font-medium text-text-primary mb-2">Verbinding Testen</h3>
            <p className="text-sm text-text-secondary mb-3">
              Test je MCP verbinding door de list_tables tool aan te roepen:
            </p>
            <Button
              variant="secondary"
              onClick={() => handleTestServer('schema-server')}
              disabled={testing === 'schema-server'}
              className="gap-1.5"
            >
              <RefreshCw size={14} className={testing === 'schema-server' ? 'animate-spin' : ''} />
              Test Schema Server
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="tools" className="space-y-6">
          <div>
            <h2 className="text-lg font-medium text-text-heading mb-4">Schema Tools</h2>
            <p className="text-text-secondary mb-4">
              Tools voor het beheren van database schema: tabellen, velden, relaties en views.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tool Naam</TableHead>
                  <TableHead>Categorie</TableHead>
                  <TableHead>Beschrijving</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {SCHEMA_MCP_TOOLS.map(tool => (
                  <ToolRow key={tool.name} tool={tool} />
                ))}
              </TableBody>
            </Table>
          </div>

          <div>
            <h2 className="text-lg font-medium text-text-heading mb-4">Data Tools</h2>
            <p className="text-text-secondary mb-4">
              Tools voor het beheren van data: records aanmaken, lezen, bijwerken en verwijderen.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tool Naam</TableHead>
                  <TableHead>Categorie</TableHead>
                  <TableHead>Beschrijving</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {DATA_MCP_TOOLS.map(tool => (
                  <ToolRow key={tool.name} tool={tool} />
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="bg-bg-elevated p-4 rounded-lg border border-border">
            <h3 className="font-medium text-text-primary mb-2">Foutmeldingen</h3>
            <p className="text-sm text-text-secondary mb-3">
              Voorbeelden van foutmeldingen bij onvoldoende rechten:
            </p>
            <div className="space-y-2 text-xs font-mono">
              <div className="bg-status-error/12 text-status-error p-2 rounded">
                {"{ \"error\": \"Insufficient permissions\", \"code\": \"FORBIDDEN\" }"}
              </div>
              <div className="bg-status-error/12 text-status-error p-2 rounded">
                {"{ \"error\": \"Read-only key cannot perform write operations\", \"code\": \"READ_ONLY\" }"}
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}