// POST /api:integrations/integrations/mcp/install - install MCP provider with API key + binding
query "integrations/mcp/install" verb=POST {
  api_group = "integrations"
  auth = "user"

  input {
    text provider filters=trim
    text api_key filters=trim
    text display_name? filters=trim
    int mcp_server_id?
    text mcp_server_id_text? filters=trim
    text server_url? filters=trim
    text auth_type? filters=trim
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

    precondition (($input.api_key|strlen) > 0) {
      error_type = "inputerror"
      error = "api_key is required."
    }

    db.query integration_providers {
      where = $db.integration_providers.slug == $input.provider
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $prov_rows

    precondition (($prov_rows|count) > 0) {
      error_type = "inputerror"
      error = "Unknown MCP provider."
    }

    var $provider {
      value = $prov_rows|first
    }

    var $is_custom {
      value = $input.provider == "custom_mcp"
    }

    conditional {
      if ($is_custom) {
        precondition ($input.server_url != null && ($input.server_url|strlen) > 0) {
          error_type = "inputerror"
          error = "server_url is required for custom MCP."
        }
      }
    }

    security.create_uuid as $conn_id

    var $label {
      value = $input.display_name != null && ($input.display_name|strlen) > 0 ? $input.display_name : $provider.name
    }

    var $auth_type_val {
      value = $input.auth_type != null && ($input.auth_type|strlen) > 0 ? $input.auth_type : "api_key"
    }

    var $conn_metadata {
      value = {}
    }

    conditional {
      if ($is_custom) {
        var.update $conn_metadata {
          value = {
            host      : "Custom MCP"
            server_url: $input.server_url
            auth_type : $auth_type_val
          }
        }
      }
    }

    db.add integration_connections {
      data = {
        id                  : $conn_id
        tenant_id           : $me.organisation_id
        provider_id         : $provider.id
        external_account_id : $conn_id|to_text
        display_name        : $label
        credentials         : {api_key: $input.api_key}
        status              : "active"
        connected_by_user_id: $me.id
        metadata            : $conn_metadata
        created_at          : now
        updated_at          : now
      }
    } as $conn

    var $mcp_id {
      value = $input.mcp_server_id != null ? $input.mcp_server_id : ($input.mcp_server_id_text|to_int)
    }

    conditional {
      if (!$is_custom && $mcp_id == null) {
        var.update $mcp_id {
          value = 8
        }
      }
    }

    security.create_uuid as $binding_id

    var $binding_config {
      value = {provider: $input.provider, mcp_server_id: $mcp_id}
    }

    conditional {
      if ($is_custom) {
        var.update $binding_config {
          value = {
            provider  : "custom_mcp"
            server_url: $input.server_url
            auth_type : $auth_type_val
          }
        }
      }
    }

    db.add integration_bindings {
      data = {
        id            : $binding_id
        tenant_id     : $me.organisation_id
        connection_id : $conn_id
        binding_type  : "mcp_server"
        project_id    : null
        config        : $binding_config
        status        : "active"
        created_at    : now
        updated_at    : now
      }
    } as $binding
  }

  response = {
    connection: $conn|pick: ["id", "display_name", "status"]
    binding   : $binding|pick: ["id", "config"]
  }
}
