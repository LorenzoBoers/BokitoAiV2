table "integration_providers" {
  auth = false
  schema {
    uuid id {
      description = "Primary key"
    }

    text slug filters=trim {
      description = "Provider slug"
    }

    uuid host_id? {
      table = "integration_hosts"
      description = "Brand host"
    }

    text name filters=trim {
      description = "Display name"
    }

    text description? filters=trim {
      description = "Marketplace description"
    }

    text category? filters=trim {
      description = "Category label"
    }

    enum auth_type?=none {
      values = ["oauth2", "api_key", "mcp_remote_oauth", "none"]
      description = "Auth mode"
    }

    json capabilities?= {
      description = "Capability flags"
    }

    enum status?=available {
      values = ["available", "coming_soon", "deprecated"]
      description = "Catalog status"
    }

    text oauth_config_key? filters=trim {
      description = "Env prefix for OAuth credentials"
    }

    text mcp_remote_url? filters=trim {
      description = "Remote MCP endpoint URL"
    }

    text mcp_transport?=streamable_http filters=trim {
      description = "MCP transport"
    }

    json oauth_profile? {
      description = "OAuth profile metadata"
    }

    json logo_meta? {
      description = "Fallback logo metadata"
    }

    int sort_order?=0 {
      description = "Sort order"
    }

    timestamp created_at?=now {
      description = "Created at"
    }

    timestamp updated_at?=now {
      description = "Updated at"
    }
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree|unique", field: [{name: "slug", op: "asc"}]}
    {type: "btree", field: [{name: "sort_order", op: "asc"}]}
  ]
}
