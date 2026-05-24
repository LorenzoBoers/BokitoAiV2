// GET /api:integrations/integrations/mcp/bindings - active MCP server bindings for tenant
query "integrations/mcp/bindings" verb=GET {
  api_group = "integrations"
  auth = "user"

  input {
  }

  stack {
    db.get user {
      field_name = "id"
      field_value = $auth.id|to_int
    } as $me

    precondition ($me != null && $me.organisation_id != null) {
      error_type = "accessdenied"
      error = "No organisation context."
    }

    db.query integration_bindings {
      where = $db.integration_bindings.tenant_id == $me.organisation_id && $db.integration_bindings.binding_type == "mcp_server" && $db.integration_bindings.status == "active"
      return = {type: "list"}
    } as $bindings

    var $server_ids {
      value = $bindings|map:$$.config.mcp_server_id|filter:$$ != null
    }
  }

  response = {bindings: $bindings, mcp_server_ids: $server_ids}
}
