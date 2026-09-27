# Bokito Cursor plugin

Installs the Bokito workspace MCP server with the Bokito logo.

## Connect

Paste only the MCP URL. On first use Cursor opens the browser — sign in and
pick a workspace. No API token required.

```json
{
  "mcpServers": {
    "bokito": {
      "url": "https://app.bokito.ai/api/mcp"
    }
  }
}
```

For CI/scripts, create a bearer token under **Settings → Developers**. Custom
`mcp.json` without this plugin shows Cursor’s generic pin icon; the plugin
supplies `assets/logo.svg`.
