// POST /api:integrations/integrations/worker/mcp-credentials - worker fetch remote MCP bearer token
query "integrations/worker/mcp-credentials" verb=POST {
  api_group = "integrations"
  auth = "false"

  input {
    uuid tenant_id
    uuid connection_id
    text worker_secret filters=trim
  }

  stack {
    precondition ($input.worker_secret == $env.WORKER_INBOUND_SECRET) {
      error_type = "accessdenied"
      error = "Invalid worker secret."
    }

    db.get integration_connections {
      field_name = "id"
      field_value = $input.connection_id
    } as $conn

    precondition ($conn != null && $conn.tenant_id == $input.tenant_id && $conn.status == "active") {
      error_type = "inputerror"
      error = "Connection not found."
    }

    db.get integration_providers {
      field_name = "id"
      field_value = $conn.provider_id
    } as $provider

    precondition ($provider != null && $provider.auth_type == "mcp_remote_oauth") {
      error_type = "inputerror"
      error = "Not a remote MCP OAuth connection."
    }

    var $creds {
      value = $conn.credentials
    }

    var $access_token {
      value = $creds.access_token|to_text
    }

    precondition (($access_token|strlen) > 0) {
      error_type = "inputerror"
      error = "No access token on connection."
    }

    var $mcp_remote_url {
      value = $creds.mcp_remote_url != null ? ($creds.mcp_remote_url|to_text) : ($provider.mcp_remote_url|to_text)
    }

    var $transport {
      value = $provider.mcp_transport != null ? ($provider.mcp_transport|to_text) : "streamable_http"
    }
  }

  response = {
    access_token   : $access_token
    refresh_token  : $creds.refresh_token
    token_type     : $creds.token_type
    mcp_remote_url : $mcp_remote_url
    transport      : $transport
    provider_slug  : $provider.slug
    connection_id  : $conn.id
  }
}
